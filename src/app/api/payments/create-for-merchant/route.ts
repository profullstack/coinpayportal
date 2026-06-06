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
 * Card:    routes via Stripe Connect on the first business of the
 *          merchant whose stripe_accounts row has charges_enabled=true,
 *          using application_fee_amount + transfer_data destination so
 *          funds land in the seller's connected account net of platform
 *          fee.
 *
 * Body:    { merchant_id, amount_usd, currency, payment_method?,
 *            description?, success_url?, cancel_url?, webhook_url?,
 *            metadata? }
 *
 * Returns: { success, payment_id, payment_method, address?,
 *            amount_crypto?, currency?, expires_at?,
 *            stripe_checkout_url?, stripe_session_id? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createPayment, Blockchain } from '@/lib/payments/service';
import { getStripe } from '@/lib/server/optional-deps';

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
  payment_method: z.enum(['crypto', 'card']).optional(),
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

  const { data } = await supabase
    .from('reputation_issuers')
    .select('did, name')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single();

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
      payment_method ?? (currency.toLowerCase() === 'card' ? 'card' : 'crypto');

    // Verify the merchant exists
    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('id', merchant_id)
      .maybeSingle();
    if (!merchant) {
      return NextResponse.json(
        { success: false, error: 'merchant not found' },
        { status: 404 },
      );
    }

    const baseMetadata: Record<string, unknown> = {
      ...(metadata || {}),
      platform: platform.name,
      platform_did: platform.did,
      cross_network: true,
    };
    if (description) baseMetadata.description = description;

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
      payment_address_id: null,
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

    const stripeSdk = await getStripe();
    const session = await stripeSdk.checkout.sessions.create({
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
      success_url: success_url || `${appUrl}/pay/${paymentId}?status=success`,
      cancel_url: cancel_url || `${appUrl}/pay/${paymentId}`,
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
