import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  TRANSFI_SIGNATURE_HEADER,
  getTransfiWebhookSecret,
  identifyTransfiEvent,
  verifyTransfiSignature,
} from '@/lib/remittance/transfi-webhook';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/transfi/webhook
 *
 * TransFi's side of the remittance rail — the analogue of /api/paypal/webhook.
 *
 * Unlike PayPal, verification is a local HMAC over the raw body, so it costs no
 * round trip and cannot fail for transport reasons: a bad signature is always a
 * bad signature. The body is read with `request.text()` and hashed exactly as
 * received, because re-serialising a parsed object produces different bytes.
 *
 * What this route deliberately does NOT do is reconcile. Remittance transfer
 * initiation is not built (docs/REMITTANCE.md explains why), so CoinPay never
 * asks TransFi to pay anyone and there is no local transfer record for an event
 * to settle against. Every verified delivery is therefore recorded and
 * acknowledged, and nothing else. When initiation lands, the handler hangs off
 * `handleEvent` below and the ledger row is already there to reconcile with.
 */
export async function POST(request: NextRequest) {
  const secret = getTransfiWebhookSecret();
  if (!secret) {
    console.error('[TransFi] Webhook received but TRANSFI_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'TransFi webhooks are not configured' }, { status: 503 });
  }

  const raw = await request.text();
  const signature = request.headers.get(TRANSFI_SIGNATURE_HEADER);

  if (!signature) {
    return NextResponse.json({ error: 'Missing TransFi signature header' }, { status: 400 });
  }

  // Verify before parsing. A body that fails the HMAC is not ours to interpret.
  if (!verifyTransfiSignature(raw, signature, secret)) {
    console.warn('[TransFi] Rejected unverified webhook');
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { eventId, eventType, orderId, status } = identifyTransfiEvent(event);

  // An event with no id cannot be de-duplicated, and recording it under an empty
  // string would collapse every such delivery onto a single unique row. Reject
  // it loudly instead — a 400 shows up in TransFi's console, a silent merge
  // would not.
  if (!eventId) {
    console.error('[TransFi] Verified webhook carries no recognisable event id');
    return NextResponse.json({ error: 'Event is missing an id' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Claim the event. Losing this insert means a duplicate delivery.
  const { error: claimError } = await supabase.from('transfi_webhook_events').insert({
    transfi_event_id: eventId,
    event_type: eventType || 'unknown',
    order_id: orderId,
    status,
    payload: event,
  });

  if (claimError) {
    // 23505 is unique_violation — the expected duplicate case.
    if ((claimError as any).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[TransFi] Failed to record webhook event:', claimError);
    return NextResponse.json({ error: 'Failed to record event' }, { status: 500 });
  }

  let processingError: string | null = null;
  try {
    await handleEvent(eventType, event);
  } catch (err) {
    // A handler that throws still returns 200 with the error on the ledger row:
    // a TransFi retry would hit the same bug and only delay the queue.
    processingError = err instanceof Error ? err.message.slice(0, 1000) : 'Unknown handler error';
    // Keep `eventType` an ARGUMENT, never part of the format string. It comes
    // from the request body, and console.error treats its first argument as a
    // format string — an eventType of "%s%s" would swallow `err` and garble the
    // log line that is the only record of the failure. Do not "tidy" this back
    // into a template literal (CodeQL js/tainted-format-string).
    console.error('[TransFi] Handler failed for event type:', eventType, err);
  }

  await supabase
    .from('transfi_webhook_events')
    .update({
      processed: !processingError,
      processing_error: processingError,
      updated_at: new Date().toISOString(),
    })
    .eq('transfi_event_id', eventId);

  return NextResponse.json({ received: true });
}

/**
 * No-op until transfer initiation exists.
 *
 * Left as a seam rather than omitted, so the reconciliation work has one
 * obvious place to land and the route above does not need reshaping to accept
 * it.
 */
// The parameters are the seam's contract; they are unused only until
// reconciliation lands.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleEvent(eventType: string, event: unknown): Promise<void> {
  return;
}

/**
 * TransFi probes the configured URL during provider setup. Answering GET keeps
 * that check green without implying the rail is live.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'transfi-webhook',
    configured: Boolean(getTransfiWebhookSecret()),
  });
}
