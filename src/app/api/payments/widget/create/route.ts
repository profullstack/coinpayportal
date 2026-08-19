import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createPayment, Blockchain } from '@/lib/payments/service';
import { getStripe } from '@/lib/server/optional-deps';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { getFeePercentage } from '@/lib/payments/fees';

/**
 * This endpoint is a public embed: payments.js runs on the merchant's own site
 * and identifies the merchant by a UUID that is, by design, visible in page
 * source. It therefore cannot require a secret. What it can do — and now does —
 * is refuse to be used as an amplifier:
 *
 *   - per-merchant and per-IP rate limits;
 *   - a ceiling on how many payments a merchant may have pending at once, so
 *     the HD address pool cannot be drained by a caller looping on create;
 *   - CORS echoed to the merchant's configured origins when they have set any,
 *     instead of an unconditional `*`.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

/**
 * Build CORS headers for a merchant. When the merchant has registered widget
 * origins, only those are echoed; otherwise the open policy is preserved so
 * existing embeds keep working.
 */
function corsFor(origin: string | null, allowedOrigins: string[] | null): Record<string, string> {
  if (!allowedOrigins || allowedOrigins.length === 0) return corsHeaders;
  const allowed = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return { ...corsHeaders, 'Access-Control-Allow-Origin': allowed };
}

/**
 * Maximum payments a single merchant may have pending at one time via the
 * widget. Each pending payment holds an HD address, so an unbounded count is a
 * pool-exhaustion primitive; no legitimate embed has thousands of checkouts
 * open simultaneously.
 */
const MAX_PENDING_WIDGET_PAYMENTS = 200;

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

const bodySchema = z.object({
  merchant_id: z.string().uuid(),
  amount_usd: z.number().positive().max(1_000_000),
  currency: z.string().min(1).max(20),
  payment_method: z.enum(['crypto', 'card']).optional(),
  description: z.string().max(500).optional(),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues.map((issue) => issue.message).join(', ') },
        { status: 400, headers: corsHeaders },
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
      metadata,
    } = parsed.data;

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id, widget_allowed_origins')
      .eq('id', merchant_id)
      .maybeSingle();

    if (!merchant) {
      return NextResponse.json(
        { success: false, error: 'merchant not found' },
        { status: 404, headers: corsHeaders },
      );
    }

    const allowedOrigins: string[] | null = Array.isArray(merchant.widget_allowed_origins)
      ? merchant.widget_allowed_origins
      : null;
    const origin = request.headers.get('origin');
    const cors = corsFor(origin, allowedOrigins);

    // When a merchant has registered origins, requests from anywhere else are
    // refused outright rather than merely blocked in the browser — CORS is a
    // browser policy and does nothing against a direct HTTP client.
    if (allowedOrigins && allowedOrigins.length > 0 && (!origin || !allowedOrigins.includes(origin))) {
      return NextResponse.json(
        { success: false, error: 'origin not allowed for this merchant' },
        { status: 403, headers: cors },
      );
    }

    // Two independent buckets: one merchant cannot be spammed from many IPs,
    // and one IP cannot walk across many merchants.
    const clientIp = getClientIp(request);
    for (const bucketKey of [`m:${merchant_id}`, `ip:${clientIp}`]) {
      const rate = await checkRateLimitAsync(bucketKey, 'widget_create');
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'rate limit exceeded' },
          { status: 429, headers: cors },
        );
      }
    }

    // Address-pool ceiling. Each pending payment holds an HD index, so without
    // this a loop on create drains the merchant's pool and every later payer
    // gets no address.
    const { count: pendingCount } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .contains('metadata', { source: 'payments.js' })
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if ((pendingCount ?? 0) >= MAX_PENDING_WIDGET_PAYMENTS) {
      return NextResponse.json(
        { success: false, error: 'too many pending payments; try again later' },
        { status: 429, headers: cors },
      );
    }

    const method = payment_method ?? (currency.toLowerCase() === 'card' ? 'card' : 'crypto');
    const baseMetadata: Record<string, unknown> = {
      ...(metadata || {}),
      source: 'payments.js',
    };
    if (description) baseMetadata.description = description;

    if (method === 'crypto') {
      const blockchain = CURRENCY_TO_BLOCKCHAIN[currency.toLowerCase()];
      if (!blockchain) {
        return NextResponse.json(
          { success: false, error: `Unsupported cryptocurrency: ${currency}` },
          { status: 400, headers: corsHeaders },
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
          { success: false, error: `Merchant has no active ${blockchain} wallet on file` },
          { status: 400, headers: corsHeaders },
        );
      }

      const businessId = await pickAnyBusiness(supabase, merchant_id);
      if (!businessId) {
        return NextResponse.json(
          { success: false, error: 'Merchant has no business configured' },
          { status: 400, headers: corsHeaders },
        );
      }

      const result = await createPayment(supabase, {
        business_id: businessId,
        amount: amount_usd,
        currency: 'USD',
        blockchain,
        merchant_wallet_address: wallet.wallet_address,
        metadata: baseMetadata,
      });

      if (!result.success || !result.payment) {
        return NextResponse.json(
          { success: false, error: result.error || 'Failed to create payment' },
          { status: 400, headers: corsHeaders },
        );
      }

      return NextResponse.json(
        {
          success: true,
          payment: {
            id: result.payment.id,
            payment_method: 'crypto',
            amount_usd,
            currency: blockchain,
            address: result.payment.payment_address,
            amount_crypto: result.payment.crypto_amount ?? null,
            expires_at: result.payment.expires_at,
            status: result.payment.status,
            qr_url: `/api/payments/${result.payment.id}/qr`,
          },
        },
        { status: 201, headers: corsHeaders },
      );
    }

    const stripe = await pickStripeBusiness(supabase, merchant_id);
    if (!stripe) {
      return NextResponse.json(
        { success: false, error: 'Merchant has not enabled card payments' },
        { status: 400, headers: corsHeaders },
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
      blockchain: 'ETH',
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
      console.error('[payments-widget-create] insert error:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to create payment record' },
        { status: 500, headers: corsHeaders },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
    const amountCents = Math.round(amount_usd * 100);
    // Tier-aware, matching the crypto rail and the direct Stripe rail. A
    // hardcoded rate here would over- or under-charge depending on the
    // merchant's plan.
    const widgetIsPaidTier = await isBusinessPaidTier(supabase, stripe.business_id);
    const platformFeeAmount = Math.round(amountCents * getFeePercentage(widgetIsPaidTier));
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
          source: 'payments.js',
        },
      },
      success_url: success_url || `${appUrl}/pay/${paymentId}?status=success`,
      cancel_url: cancel_url || `${appUrl}/pay/${paymentId}`,
      metadata: {
        coinpay_payment_id: paymentId,
        business_id: stripe.business_id,
        merchant_id,
        source: 'payments.js',
      },
    });

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
        payment: {
          id: paymentId,
          payment_method: 'card',
          amount_usd,
          currency: 'card',
          status: 'pending',
          expires_at: expiresAt,
          checkout_url: session.url,
        },
      },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    console.error('[payments-widget-create] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders },
    );
  }
}
