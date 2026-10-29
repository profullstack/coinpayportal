/**
 * POST /api/payments/create-for-merchant
 *
 * Platform-keyed payment creator. Lets a network app (d0rz, c0mpute,
 * etc.) initiate a payment routed to a specific seller identified only
 * by their CoinPay `merchant_id`. The app's OAuth handshake with the
 * user proves user consent to link; the platform issuer key proves the
 * caller is the platform we expect.
 *
 * Crypto:  looks up the seller's address from merchant_wallets (the
 *          user-managed table behind /settings/wallets) for the
 *          requested cryptocurrency.
 *
 * PayPal:  opens a PayPal order on the seller's first business with a
 *          connected PayPal account (paypal_accounts.connected), the same
 *          path as POST /api/paypal/payments/create. Ask for it with
 *          payment_method: 'paypal' (or currency: 'paypal').
 *
 * Card:    routes via Stripe Connect on the first business of the
 *          merchant whose stripe_accounts row has charges_enabled=true,
 *          using application_fee_amount + transfer_data destination so
 *          funds land in the seller's connected account net of platform
 *          fee.
 *
 * Body:    { merchant_id, amount_usd, currency, payment_method?,
 *            description?, success_url?, cancel_url?, webhook_url?,
 *            metadata?, customer_email?, account_id?, property? }
 *
 *          customer_email / account_id / property are optional: a malformed
 *          value is dropped, never a 400, so existing callers keep working.
 *          They are stored in the payment metadata, so every webhook carries
 *          them, the same as /api/payments/create.
 *
 * Returns: { success, payment_id, payment_method, address?,
 *            amount_crypto?, currency?, expires_at?,
 *            checkout_url?, paypal_approve_url?, paypal_order_id?,
 *            stripe_checkout_url?, stripe_session_id? }
 */

import { STRIPE_ENABLED, stripeGone } from '@/lib/stripe/archived';
import { NextRequest, NextResponse } from 'next/server';
import { sanitizeStripeMetadata } from '@/lib/stripe/metadata';
import { platformMayManageMerchant } from '@/lib/p2p/platform-ownership';
import { hashApiKey } from '@/lib/auth/scoped-keys';
import { screenCheckout } from '@/lib/fraud/screen';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createPayment, Blockchain } from '@/lib/payments/service';
import { resolveReturnUrl, returnUrlMetadata } from '@/lib/payments/return-url';
import { getStripe } from '@/lib/server/optional-deps';
import { customerMetadata } from '@/lib/checkout/customer';
import { createPaypalPaymentForBusiness } from '@/lib/paypal/create-payment';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

const bodySchema = z.object({
  merchant_id: z.string().uuid(),
  amount_usd: z.number().positive().max(1_000_000),
  currency: z.string().min(1).max(20),
  payment_method: z.enum(['crypto', 'card', 'paypal']).optional(),
  description: z.string().max(500).optional(),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
  webhook_url: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const CURRENCY_TO_BLOCKCHAIN: Record<string, Blockchain> = {
  btc: 'BTC',
  bch: 'BCH',
  eth: 'ETH',
  pol: 'POL',
  sol: 'SOL',
  doge: 'DOGE',
  xrp: 'XRP',
  ada: 'ADA',
  bnb: 'BNB',
  usdt: 'USDT',
  usdt_eth: 'USDT_ETH',
  usdt_pol: 'USDT_POL',
  usdt_sol: 'USDT_SOL',
  usdc: 'USDC',
  usdc_eth: 'USDC_ETH',
  usdc_pol: 'USDC_POL',
  usdc_sol: 'USDC_SOL',
  usdc_base: 'USDC_BASE',
};

async function authenticatePlatform(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest,
): Promise<{ did: string; name: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const apiKey = authHeader.slice(7);

  // Match on the HASH first, falling back to the legacy cleartext column while
  // it drains. Same contract as /api/p2p/request.
  const { data: byHash } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key_hash', hashApiKey(apiKey))
    .eq('active', true)
    .maybeSingle();

  if (byHash) return byHash;

  const { data } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .maybeSingle();

  return data;
}

async function pickStripeBusiness(
  supabase: ReturnType<typeof getSupabase>,
  merchantId: string,
): Promise<{ business_id: string; stripe_account_id: string } | null> {
  const { data } = await supabase
    .from('stripe_accounts')
    .select('business_id, stripe_account_id, charges_enabled')
    .eq('merchant_id', merchantId)
    .eq('charges_enabled', true)
    .order('created_at', { ascending: true })
    .limit(1);
  const row = data?.[0];
  if (!row?.business_id || !row.stripe_account_id) return null;
  return {
    business_id: row.business_id,
    stripe_account_id: row.stripe_account_id,
  };
}

async function pickPaypalBusiness(
  supabase: ReturnType<typeof getSupabase>,
  merchantId: string,
): Promise<string | null> {
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: true });
  const ids = (businesses ?? []).map((b: { id: string }) => b.id);
  if (ids.length === 0) return null;
  const { data: accounts } = await supabase
    .from('paypal_accounts')
    .select('business_id, created_at')
    .in('business_id', ids)
    .eq('connected', true)
    .order('created_at', { ascending: true });
  // Oldest business first, matching pickAnyBusiness for the crypto rail.
  const connected = new Set((accounts ?? []).map((a: { business_id: string }) => a.business_id));
  return ids.find((id) => connected.has(id)) ?? null;
}

async function pickAnyBusiness(
  supabase: ReturnType<typeof getSupabase>,
  merchantId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const platform = await authenticatePlatform(supabase, request);
    if (!platform) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing API key' },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        },
        { status: 400 },
      );
    }

    const {
      merchant_id,
      amount_usd,
      currency,
      payment_method,
      description,
      success_url,
      cancel_url,
      webhook_url,
      metadata,
    } = parsed.data;

    const method =
      payment_method ??
      (currency.toLowerCase() === 'card'
        ? 'card'
        : currency.toLowerCase() === 'paypal'
          ? 'paypal'
          : 'crypto');
    if (!STRIPE_ENABLED && method === 'card') {
      return stripeGone();
    }

    // Verify the platform may act for this merchant — not merely that the
    // merchant exists.
    //
    // The route authenticated an issuer key and then took `merchant_id` from
    // the body, so any valid issuer could create payments on behalf of ANY
    // merchant on the platform. Combined with CP-002 (issuer registration was
    // open and auto-activated), that made "anyone with an email address" the
    // real trust boundary on creating charges in someone else's name.
    const owns = await platformMayManageMerchant(supabase, platform.name, merchant_id);
    if (!owns.ok) {
      return NextResponse.json({ success: false, error: owns.error }, { status: owns.status });
    }

    const baseMetadata: Record<string, unknown> = {
      ...sanitizeStripeMetadata(metadata, 'payments/create-for-merchant'),
      platform: platform.name,
      platform_did: platform.did,
      cross_network: true,
    };
    if (description) baseMetadata.description = description;

    // Who paid and for which property. Optional on this route: a missing or
    // malformed value is dropped (non-strict), never a 400. Read from the top
    // level, falling back to the same keys inside metadata.
    const customerFields = customerMetadata({
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      ...(body && typeof body === 'object' ? body : {}),
    });
    if (customerFields.ok) Object.assign(baseMetadata, customerFields.metadata);

    // Stripe-style return URLs, kept on the payment so the crypto pay page
    // sends the buyer back too, not only the card rail.
    const returnUrls = returnUrlMetadata({ success_url, cancel_url });
    if (!returnUrls.ok) {
      return NextResponse.json(
        { success: false, error: returnUrls.error, code: returnUrls.code },
        { status: 400 },
      );
    }
    Object.assign(baseMetadata, returnUrls.metadata);

    // ── crypto branch ────────────────────────────────────────────────
    if (method === 'crypto') {
      const blockchain = CURRENCY_TO_BLOCKCHAIN[currency.toLowerCase()];
      if (!blockchain) {
        return NextResponse.json(
          { success: false, error: `Unsupported cryptocurrency: ${currency}` },
          { status: 400 },
        );
      }

      const { data: wallet } = await supabase
        .from('merchant_wallets')
        .select('wallet_address')
        .eq('merchant_id', merchant_id)
        .eq('cryptocurrency', blockchain)
        .eq('is_active', true)
        .maybeSingle();
      if (!wallet?.wallet_address) {
        return NextResponse.json(
          {
            success: false,
            error: `Seller has no active ${blockchain} wallet on file`,
          },
          { status: 400 },
        );
      }

      const business_id = await pickAnyBusiness(supabase, merchant_id);
      if (!business_id) {
        return NextResponse.json(
          { success: false, error: 'Seller has no business configured' },
          { status: 400 },
        );
      }

      const result = await createPayment(supabase, {
        business_id,
        amount: amount_usd,
        currency: 'USD',
        blockchain,
        merchant_wallet_address: wallet.wallet_address,
        metadata: baseMetadata,
      });
      if (!result.success || !result.payment) {
        return NextResponse.json(
          { success: false, error: result.error || 'Failed to create payment' },
          { status: 400 },
        );
      }
      return NextResponse.json(
        {
          success: true,
          payment_id: result.payment.id,
          payment_method: 'crypto',
          address: result.payment.payment_address,
          amount_crypto:
            (result.payment as { amount_crypto?: number; crypto_amount?: number })
              .amount_crypto ??
            (result.payment as { amount_crypto?: number; crypto_amount?: number })
              .crypto_amount ??
            null,
          currency: blockchain,
          expires_at: result.payment.expires_at,
        },
        { status: 201 },
      );
    }

    // ── PayPal branch ────────────────────────────────────────────────
    if (method === 'paypal') {
      const paypalBusinessId = await pickPaypalBusiness(supabase, merchant_id);
      if (!paypalBusinessId) {
        return NextResponse.json(
          {
            success: false,
            error: 'Seller has not connected PayPal: PayPal payments unavailable',
            code: 'PAYPAL_NOT_CONNECTED',
          },
          { status: 400 },
        );
      }
      const result = await createPaypalPaymentForBusiness(supabase, {
        businessId: paypalBusinessId,
        amount: Math.round(amount_usd * 100) / 100,
        currency: 'USD',
        description: description ?? null,
        metadata: { ...baseMetadata, payment_method: 'paypal' },
        // The hosted PayPal page sends the payer here after capture/cancel.
        successUrl: returnUrls.metadata.redirect_url ?? null,
        cancelUrl: returnUrls.metadata.cancel_url ?? null,
        customerEmail: (baseMetadata.customer_email as string | undefined) ?? null,
        clientIp: getClientIp(request),
      });
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status },
        );
      }
      return NextResponse.json(
        {
          success: true,
          payment_id: result.response.transaction_id,
          payment_method: 'paypal',
          checkout_url: result.response.checkout_url,
          paypal_approve_url: result.response.approve_url,
          paypal_order_id: result.response.order_id,
          amount_usd: result.response.amount,
          currency: 'USD',
        },
        { status: 201 },
      );
    }

    // ── card branch ──────────────────────────────────────────────────
    const stripe = await pickStripeBusiness(supabase, merchant_id);
    if (!stripe) {
      return NextResponse.json(
        {
          success: false,
          error: 'Seller has not connected Stripe — card payments unavailable',
        },
        { status: 400 },
      );
    }

    const paymentId = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from('payments').insert({
      id: paymentId,
      business_id: stripe.business_id,
      amount: amount_usd.toString(),
      currency: 'USD',
      blockchain: 'ETH', // schema requires non-null; card-only payments
      status: 'pending',
      payment_address: '',
      // `payment_address_id` is not a column on `payments` — it was dropped in a
      // November 2025 migration and its absence is confirmed against the live
      // schema. PostgREST rejects an insert naming an unknown column outright,
      // so every card payment through this route failed with a 500 before it
      // ever reached Stripe.
      merchant_wallet_address: '',
      metadata: { ...baseMetadata, payment_method: 'card' },
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error('[create-for-merchant] insert error:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to create payment record' },
        { status: 500 },
      );
    }

    const amountCents = Math.round(amount_usd * 100);
    const platformFeeAmount = Math.round(amountCents * 0.01); // 1% — match existing default
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';

    // Screen before the Stripe session exists. One of the seven paths that
    // create a real card charge; only one of the seven was screened.
    const screening = await screenCheckout(supabase, {
      businessId: stripe.business_id,
      ip: getClientIp(request),
      amount: amount_usd,
      currency: 'USD',
      description,
    });

    if (screening.decision === 'block') {
      console.warn('[Fraud] Blocked create-for-merchant checkout', {
        businessId: stripe.business_id,
        score: screening.score,
        findings: screening.findings.map((f) => f.code).join(', '),
      });
      return NextResponse.json(
        { success: false, error: screening.buyerMessage },
        { status: 403 },
      );
    }

    const stripeSdk = await getStripe();
    const session = await stripeSdk.checkout.sessions.create({
      ...(screening.decision === 'verify'
        ? { payment_method_options: { card: { request_three_d_secure: 'any' as const } } }
        : {}),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: description || 'Payment' },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount: platformFeeAmount,
        transfer_data: { destination: stripe.stripe_account_id },
        metadata: {
          coinpay_payment_id: paymentId,
          business_id: stripe.business_id,
          merchant_id,
          platform: platform.name,
        },
      },
      success_url: returnUrls.metadata.redirect_url
        ? resolveReturnUrl(returnUrls.metadata.redirect_url, paymentId)
        : `${appUrl}/pay/${paymentId}?status=success`,
      cancel_url: returnUrls.metadata.cancel_url
        ? resolveReturnUrl(returnUrls.metadata.cancel_url, paymentId)
        : `${appUrl}/pay/${paymentId}`,
      metadata: {
        coinpay_payment_id: paymentId,
        business_id: stripe.business_id,
        merchant_id,
        platform: platform.name,
      },
    });

    // Persist the stripe session id on the payment row for webhook reconciliation
    await supabase
      .from('payments')
      .update({
        metadata: {
          ...baseMetadata,
          payment_method: 'card',
          stripe_session_id: session.id,
        },
      })
      .eq('id', paymentId);

    return NextResponse.json(
      {
        success: true,
        payment_id: paymentId,
        payment_method: 'card',
        stripe_checkout_url: session.url,
        stripe_session_id: session.id,
        expires_at: expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[create-for-merchant] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
