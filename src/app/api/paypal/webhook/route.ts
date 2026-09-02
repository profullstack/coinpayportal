import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyPaypalWebhookSignature, type PaypalCapture } from '@/lib/paypal/client';
import { getPaypalPlatformConfig } from '@/lib/paypal/platform';
import { getMerchantIntegration } from '@/lib/paypal/partner';
import { findPaypalTransaction, settlePaypalCapture } from '@/lib/paypal/settle';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/paypal/webhook
 *
 * PayPal's side of the rail — the analogue of /api/stripe/webhook.
 *
 * Two things differ from Stripe and both shape this file:
 *
 *  1. There is no local HMAC. Verification is a round trip to PayPal, so it
 *     costs a request and can fail for transport reasons. Any non-SUCCESS is
 *     treated as unverified and rejected with 401.
 *  2. PayPal retries until it gets a 2xx, and re-delivers some events anyway.
 *     Every event is therefore claimed in `paypal_webhook_events` (UNIQUE on the
 *     PayPal event id) before any work happens; a duplicate loses that insert
 *     and returns 200 without reprocessing.
 *
 * A handler that throws still returns 200 with the error recorded on the ledger
 * row, because a PayPal retry would hit the same bug and only delay the queue.
 * The row is the thing to look at when a payment is stuck.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();

  const config = getPaypalPlatformConfig();
  if (!config?.webhookId) {
    console.error('[PayPal] Webhook received but PAYPAL_WEBHOOK_ID is not configured');
    return NextResponse.json({ error: 'PayPal webhooks are not configured' }, { status: 503 });
  }

  const raw = await request.text();

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const headers = {
    transmissionId: request.headers.get('paypal-transmission-id') || '',
    transmissionTime: request.headers.get('paypal-transmission-time') || '',
    transmissionSig: request.headers.get('paypal-transmission-sig') || '',
    certUrl: request.headers.get('paypal-cert-url') || '',
    authAlgo: request.headers.get('paypal-auth-algo') || '',
  };

  if (!headers.transmissionId || !headers.transmissionSig || !headers.certUrl) {
    return NextResponse.json({ error: 'Missing PayPal signature headers' }, { status: 400 });
  }

  const verified = await verifyPaypalWebhookSignature({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    environment: config.environment,
    webhookId: config.webhookId,
    event,
    ...headers,
  });

  if (!verified) {
    console.warn('[PayPal] Rejected unverified webhook', { id: event?.id, type: event?.event_type });
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
  }

  const eventId = String(event?.id || '');
  const eventType = String(event?.event_type || '');
  if (!eventId || !eventType) {
    return NextResponse.json({ error: 'Event is missing id or event_type' }, { status: 400 });
  }

  // Claim the event. Losing this insert means a duplicate delivery.
  const { error: claimError } = await supabase.from('paypal_webhook_events').insert({
    paypal_event_id: eventId,
    event_type: eventType,
    resource_type: event?.resource_type ?? null,
    payload: event,
  });

  if (claimError) {
    // 23505 is unique_violation — the expected duplicate case.
    if ((claimError as any).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[PayPal] Failed to record webhook event:', claimError);
    return NextResponse.json({ error: 'Failed to record event' }, { status: 500 });
  }

  let businessId: string | null = null;
  let processingError: string | null = null;

  try {
    businessId = await handleEvent(supabase, eventType, event);
  } catch (err) {
    processingError = err instanceof Error ? err.message.slice(0, 1000) : 'Unknown handler error';
    console.error(`[PayPal] Handler for ${eventType} failed:`, err);
  }

  await supabase
    .from('paypal_webhook_events')
    .update({
      processed: !processingError,
      processing_error: processingError,
      business_id: businessId,
      updated_at: new Date().toISOString(),
    })
    .eq('paypal_event_id', eventId);

  return NextResponse.json({ received: true });
}

/** Returns the business id the event touched, for the ledger row. */
async function handleEvent(supabase: any, eventType: string, event: any): Promise<string | null> {
  switch (eventType) {
    case 'CHECKOUT.ORDER.APPROVED':
      return handleOrderApproved(supabase, event);

    case 'PAYMENT.CAPTURE.COMPLETED':
      return handleCaptureCompleted(supabase, event);

    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED':
      return handleCaptureFailed(supabase, event, 'declined');

    case 'PAYMENT.CAPTURE.REVERSED':
      return handleCaptureFailed(supabase, event, 'failed');

    case 'PAYMENT.CAPTURE.REFUNDED':
      return handleCaptureRefunded(supabase, event);

    case 'MERCHANT.ONBOARDING.COMPLETED':
      return handleOnboardingCompleted(supabase, event);

    case 'MERCHANT.PARTNER-CONSENT.REVOKED':
      return handleConsentRevoked(supabase, event);

    default:
      // Unhandled events are still recorded on the ledger, which is how we find
      // out an event type matters before anyone reports a bug.
      console.log(`[PayPal] Unhandled webhook event: ${eventType}`);
      return null;
  }
}

function orderIdFromResource(resource: any): string | null {
  return (
    resource?.supplementary_data?.related_ids?.order_id ??
    // On CHECKOUT.ORDER.* the resource IS the order.
    (resource?.purchase_units ? resource?.id : null) ??
    null
  );
}

function customIdFromResource(resource: any): string | null {
  return resource?.custom_id ?? resource?.purchase_units?.[0]?.custom_id ?? null;
}

async function handleOrderApproved(supabase: any, event: any): Promise<string | null> {
  const resource = event?.resource;
  const transaction = await findPaypalTransaction(supabase, {
    orderId: resource?.id ?? null,
    customId: customIdFromResource(resource),
  });
  if (!transaction) return null;

  // Only advance a still-pending row. An approval arriving after the capture
  // webhook must not walk a completed payment backwards.
  await supabase
    .from('paypal_transactions')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', transaction.id)
    .eq('status', 'pending');

  return transaction.business_id;
}

async function handleCaptureCompleted(supabase: any, event: any): Promise<string | null> {
  const resource = event?.resource;
  const transaction = await findPaypalTransaction(supabase, {
    orderId: orderIdFromResource(resource),
    customId: customIdFromResource(resource),
  });

  if (!transaction) {
    console.warn('[PayPal] Capture completed for an unknown transaction', {
      captureId: resource?.id,
      orderId: orderIdFromResource(resource),
    });
    return null;
  }

  const breakdown = resource?.seller_receivable_breakdown;
  const capture: PaypalCapture = {
    status: 'COMPLETED',
    captureId: resource?.id ?? null,
    payerEmail: resource?.payer?.email_address ?? null,
    amount: resource?.amount?.value ?? null,
    currency: resource?.amount?.currency_code ?? null,
    paypalFee: breakdown?.paypal_fee?.value ?? null,
    netAmount: breakdown?.net_amount?.value ?? null,
    platformFee: breakdown?.platform_fees?.[0]?.amount?.value ?? null,
    payeeMerchantId: resource?.payee?.merchant_id ?? null,
    customId: customIdFromResource(resource),
  };

  await settlePaypalCapture(supabase, transaction, capture);
  return transaction.business_id;
}

async function handleCaptureFailed(
  supabase: any,
  event: any,
  status: 'declined' | 'failed'
): Promise<string | null> {
  const resource = event?.resource;
  const transaction = await findPaypalTransaction(supabase, {
    orderId: orderIdFromResource(resource),
    customId: customIdFromResource(resource),
  });
  if (!transaction) return null;

  await supabase
    .from('paypal_transactions')
    .update({
      status,
      failure_reason: resource?.status_details?.reason ?? event?.summary ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id)
    .neq('status', 'completed');

  return transaction.business_id;
}

async function handleCaptureRefunded(supabase: any, event: any): Promise<string | null> {
  const resource = event?.resource;
  // On a refund the resource is the REFUND; the capture it reverses is a link.
  const captureId =
    resource?.links
      ?.find((l: any) => l?.rel === 'up')
      ?.href?.split('/')
      .pop() ?? null;

  let transaction = null;
  if (captureId) {
    const { data } = await supabase
      .from('paypal_transactions')
      .select(
        'id, business_id, merchant_id, amount, currency, status, invoice_number, ' +
          'customer_email, platform_fee_amount, paypal_order_id, refunded_amount'
      )
      .eq('paypal_capture_id', captureId)
      .maybeSingle();
    transaction = data;
  }
  if (!transaction) {
    transaction = await findPaypalTransaction(supabase, {
      orderId: orderIdFromResource(resource),
      customId: customIdFromResource(resource),
    });
  }
  if (!transaction) return null;

  const refundAmount = Number(resource?.amount?.value ?? 0);
  const previouslyRefunded = Number((transaction as any).refunded_amount ?? 0);
  const totalRefunded = Math.round((previouslyRefunded + refundAmount) * 100) / 100;
  const original = Number(transaction.amount ?? 0);

  await supabase
    .from('paypal_transactions')
    .update({
      status: totalRefunded >= original ? 'refunded' : 'partially_refunded',
      refunded_amount: totalRefunded,
      paypal_refund_id: resource?.id ?? null,
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id);

  return transaction.business_id;
}

async function handleOnboardingCompleted(supabase: any, event: any): Promise<string | null> {
  const resource = event?.resource;
  // tracking_id is our business id — we set it when creating the referral.
  const trackingId = resource?.tracking_id ?? null;
  const merchantIdInPaypal = resource?.merchant_id ?? null;

  if (!trackingId) {
    console.warn('[PayPal] Onboarding completed without a tracking_id', { merchantIdInPaypal });
    return null;
  }

  const config = getPaypalPlatformConfig();
  if (!config) return trackingId;

  // The webhook says onboarding finished; it does NOT reliably say whether the
  // merchant can receive payments yet. Read the integration back rather than
  // marking an account connected that will fail its first order.
  let integration = null;
  try {
    integration = await getMerchantIntegration({
      config,
      merchantIdOrTrackingId: merchantIdInPaypal || trackingId,
    });
  } catch (err) {
    console.error('[PayPal] Integration lookup during onboarding webhook failed:', err);
  }

  const receivable = !!(integration?.paymentsReceivable && integration?.oauthThirdPartyGranted);

  await supabase
    .from('paypal_accounts')
    .update({
      merchant_id_in_paypal: integration?.merchantIdInPaypal ?? merchantIdInPaypal,
      email: integration?.email ?? resource?.primary_email ?? null,
      payments_receivable: integration?.paymentsReceivable ?? false,
      primary_email_confirmed: integration?.primaryEmailConfirmed ?? false,
      oauth_third_party_granted: integration?.oauthThirdPartyGranted ?? false,
      scopes: integration?.scopes ?? [],
      product_status: integration?.productStatus ?? null,
      connected: receivable,
      onboarded_at: receivable ? new Date().toISOString() : null,
      last_status_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('business_id', trackingId)
    .eq('connection_mode', 'partner');

  return trackingId;
}

async function handleConsentRevoked(supabase: any, event: any): Promise<string | null> {
  const merchantIdInPaypal = event?.resource?.merchant_id ?? null;
  if (!merchantIdInPaypal) return null;

  // The merchant pulled our permissions in their PayPal account. Every
  // subsequent order would 401, so mark it disconnected now — a dashboard that
  // still says "connected" is worse than one that says "reconnect".
  const { data } = await supabase
    .from('paypal_accounts')
    .update({
      connected: false,
      payments_receivable: false,
      oauth_third_party_granted: false,
      updated_at: new Date().toISOString(),
    })
    .eq('merchant_id_in_paypal', merchantIdInPaypal)
    .select('business_id')
    .maybeSingle();

  return data?.business_id ?? null;
}
