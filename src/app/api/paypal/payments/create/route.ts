import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPaypalOrder } from '@/lib/paypal/client';
import { resolvePaypalContext } from '@/lib/paypal/accounts';
import { screenCheckout } from '@/lib/fraud/screen';
import { authorizePaymentCreation } from '@/lib/auth/payment-auth';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { getFeePercentage } from '@/lib/payments/fees';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Resolve the requested amount into major units.
 *
 * MONEY UNITS, read this before changing anything here. The Stripe rail takes
 * `amount` in MINOR units (cents) because that is Stripe's API. PayPal's API is
 * decimal-string MAJOR units. An integration that switches rails and reposts the
 * same body would otherwise be charged 100x or 1/100th with no error anywhere.
 *
 * So: `amount_cents` is explicit and wins. Bare `amount` is MAJOR units, which
 * matches PayPal and matches what `paypal_transactions.amount` stores. Passing
 * both is a caller bug and is rejected rather than guessed at.
 */
function resolveAmount(body: any): { amount: number } | { error: string } {
  const hasCents = body.amount_cents !== undefined && body.amount_cents !== null;
  const hasMajor = body.amount !== undefined && body.amount !== null;

  if (hasCents && hasMajor) {
    return { error: 'Pass either amount (major units) or amount_cents, not both' };
  }
  if (!hasCents && !hasMajor) {
    return { error: 'amount is required' };
  }

  const raw = hasCents ? Number(body.amount_cents) : Number(body.amount);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { error: 'amount must be a positive number' };
  }
  if (hasCents && !Number.isInteger(raw)) {
    return { error: 'amount_cents must be a whole number of minor units' };
  }

  const amount = hasCents ? raw / 100 : raw;
  // PayPal rejects more than 2 decimal places on every currency we support.
  const rounded = Math.round(amount * 100) / 100;
  if (rounded <= 0) {
    return { error: 'amount is too small to charge' };
  }
  return { amount: rounded };
}

/**
 * POST /api/paypal/payments/create
 *
 * Open a PayPal order for a business and return the approval URL — the PayPal
 * analogue of POST /api/stripe/payments/create.
 *
 * On a partner-onboarded business this is a multiparty order: funds go straight
 * to the merchant's PayPal account and CoinPay's commission rides along as a
 * `platform_fees` entry, the same economics as the Stripe destination charge.
 * On a self-serve business PayPal treats the call as first-party and forbids a
 * platform fee, so the commission is 0 and the response says so.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const {
      businessId: rawBusinessId,
      business_id: snakeBusinessId,
      currency = 'USD',
      description,
      metadata = {},
      successUrl,
      success_url,
      cancelUrl,
      cancel_url,
      customerEmail,
      customer_email,
      customerName,
      customer_name,
      invoiceNumber: callerInvoiceNumber,
    } = body;

    const businessId = rawBusinessId || snakeBusinessId;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const amountResult = resolveAmount(body);
    if ('error' in amountResult) {
      return NextResponse.json({ error: amountResult.error }, { status: 400 });
    }
    const { amount } = amountResult;

    // Only the merchant being charged for (or the platform) may open an order
    // against their PayPal account. Same gate as the Stripe rail.
    const auth = await authorizePaymentCreation(supabase, request, businessId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const customerEmailValue =
      typeof (customerEmail ?? customer_email) === 'string' && (customerEmail ?? customer_email).trim()
        ? (customerEmail ?? customer_email).trim()
        : null;
    const customerNameValue =
      typeof (customerName ?? customer_name) === 'string' && (customerName ?? customer_name).trim()
        ? (customerName ?? customer_name).trim()
        : null;

    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('merchant_id, name')
      .eq('id', businessId)
      .single();

    if (bizError || !business) {
      console.error('[PayPal] Business lookup failed:', bizError);
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const context = await resolvePaypalContext(supabase, businessId);
    if ('error' in context) {
      return NextResponse.json({ error: context.error }, { status: context.status });
    }

    // Screen before the order exists — the last point at which we can stop a
    // payment without PayPal ever seeing it.
    const screening = await screenCheckout(supabase, {
      businessId,
      email: customerEmailValue,
      ip: getClientIp(request),
      amount,
      currency,
      description,
    });

    if (screening.decision === 'block') {
      console.warn('[Fraud] Blocked PayPal checkout', {
        businessId,
        score: screening.score,
        findings: screening.findings.map((f) => f.code).join(', '),
      });
      return NextResponse.json({ error: screening.buyerMessage }, { status: 403 });
    }

    // The Stripe rail answers elevated risk by forcing 3-D Secure. PayPal has no
    // equivalent lever we can pull per-order — liability sits with PayPal's own
    // Seller Protection — so an elevated score is recorded and allowed through
    // rather than silently treated as if it had been stepped up.
    if (screening.decision === 'verify') {
      console.warn('[Fraud] Elevated-risk PayPal checkout allowed (no 3DS equivalent)', {
        businessId,
        score: screening.score,
        findings: screening.findings.map((f) => f.code).join(', '),
      });
    }

    // Platform fee at the merchant's real tier. isBusinessPaidTier is the single
    // source of truth and already enforces subscription expiry — do not
    // hardcode a rate here, that is what caused the 50% shortfall on the Stripe
    // rail before it was fixed.
    const isPaidTier = await isBusinessPaidTier(supabase, businessId);
    const platformFeeRate = getFeePercentage(isPaidTier);
    const platformFeeAmount = context.supportsPlatformFee
      ? Math.round(amount * platformFeeRate * 100) / 100
      : 0;

    const invoiceNumber =
      (typeof callerInvoiceNumber === 'string' && callerInvoiceNumber.trim()) ||
      `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';

    // The row is written BEFORE the order so its id can travel to PayPal as
    // custom_id. That id is what the webhook uses to find this row without
    // trusting anything the payer's browser sends back.
    const { data: inserted, error: insertError } = await supabase
      .from('paypal_transactions')
      .insert({
        merchant_id: business.merchant_id,
        business_id: businessId,
        // Placeholder: replaced with the real order id immediately below. The
        // column is NOT NULL UNIQUE, so it needs a unique value now.
        paypal_order_id: `pending:${invoiceNumber}`,
        connection_mode: context.mode,
        amount,
        currency: String(currency).toUpperCase(),
        platform_fee_amount: platformFeeAmount,
        status: 'pending',
        invoice_number: invoiceNumber,
        description: typeof description === 'string' ? description.slice(0, 500) : null,
        customer_email: customerEmailValue,
        customer_name: customerNameValue,
        payee_merchant_id: context.payeeMerchantId,
        metadata: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          business_id: businessId,
          merchant_id: business.merchant_id,
          fraud_score: screening.score,
          fraud_decision: screening.decision,
        },
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error('[PayPal] transaction insert error:', insertError);
      return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 });
    }

    let order;
    try {
      order = await createPaypalOrder({
        ...context.creds,
        ...context.callContext,
        // Idempotency: a retried create with the same row never opens a second
        // order on the merchant's account.
        requestId: inserted.id,
        amount,
        currency,
        referenceId: invoiceNumber,
        description: description || `Payment to ${business.name || 'merchant'}`,
        brandName: business.name || 'CoinPay',
        customId: inserted.id,
        invoiceId: invoiceNumber,
        payerEmail: customerEmailValue,
        returnUrl:
          (typeof (successUrl ?? success_url) === 'string' && (successUrl ?? success_url)) ||
          `${appUrl}/pay/paypal/return?transaction_id=${inserted.id}`,
        cancelUrl:
          (typeof (cancelUrl ?? cancel_url) === 'string' && (cancelUrl ?? cancel_url)) ||
          `${appUrl}/pay/paypal/return?cancelled=1&transaction_id=${inserted.id}`,
        payeeMerchantId: context.payeeMerchantId,
        platformFee: platformFeeAmount > 0 ? platformFeeAmount : null,
        platformFeePayeeMerchantId: context.platformFeePayeeMerchantId,
      });
    } catch (err) {
      // Mark the placeholder failed rather than leaving a permanently pending
      // row that no webhook will ever resolve.
      await supabase
        .from('paypal_transactions')
        .update({
          status: 'failed',
          failure_reason: err instanceof Error ? err.message.slice(0, 500) : 'PayPal order creation failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', inserted.id);

      console.error('[PayPal] Order creation failed:', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to create PayPal order' },
        { status: 502 }
      );
    }

    const { error: bindError } = await supabase
      .from('paypal_transactions')
      .update({ paypal_order_id: order.orderId, updated_at: new Date().toISOString() })
      .eq('id', inserted.id);

    if (bindError) {
      // The order exists at PayPal but we could not bind it. Capture would then
      // have no row to settle, so refuse the checkout rather than hand the payer
      // a URL that pays into a void.
      console.error('[PayPal] Failed to bind order id to transaction:', bindError);
      return NextResponse.json({ error: 'Failed to record PayPal order' }, { status: 500 });
    }

    return NextResponse.json({
      invoice_number: invoiceNumber,
      transaction_id: inserted.id,
      order_id: order.orderId,
      // `checkout_url` is an alias of `approve_url` so an integration written
      // against the Stripe rail reads the same field name on both.
      approve_url: order.approveUrl,
      checkout_url: order.approveUrl,
      amount,
      currency: String(currency).toUpperCase(),
      platform_fee_amount: platformFeeAmount,
      platform_fee_supported: context.supportsPlatformFee,
      connection_mode: context.mode,
    });
  } catch (error: any) {
    console.error('PayPal payment creation error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to create payment' },
      { status: 500 }
    );
  }
}
