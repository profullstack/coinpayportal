import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Durable webhook retry, with a dead-letter state.
 *
 * REC-D-07: `deliverWebhook` retries three times in-process with exponential
 * backoff, which spends the entire retry budget inside one request over roughly
 * three seconds. A merchant endpoint down for four seconds — a deploy, a
 * restart, a brief network fault — loses the event permanently, as does any
 * delivery in flight when our own process is recycled. Merchants reconcile
 * against these, so a lost `payment.confirmed` is a payment the merchant never
 * hears about.
 *
 * This is the part that survives the process: an exhausted in-process attempt
 * is written to `webhook_deliveries` and retried later by the cron, on a
 * backoff measured in minutes rather than seconds. After `max_attempts` the row
 * becomes `dead` — the dead-letter — which is a durable record an operator can
 * find, rather than an event that silently evaporated.
 */

/** 1m, 5m, 15m, 1h, 3h, 6h, 12h — then dead. Roughly a day of grace. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360, 720];

export function backoffMinutesForAttempt(attempt: number): number {
  return BACKOFF_MINUTES[Math.min(attempt, BACKOFF_MINUTES.length - 1)];
}

export interface EnqueueInput {
  businessId: string;
  event: string;
  webhookUrl: string;
  payload: unknown;
  paymentId?: string | null;
  escrowId?: string | null;
  lastError?: string;
  lastStatusCode?: number;
}

/**
 * Record a delivery that the in-process attempts could not complete.
 *
 * Deliberately best-effort: it must never throw into the caller. The webhook
 * has already failed at this point, and turning that into an exception inside a
 * payment path would convert a missed notification into a failed payment.
 */
export async function enqueueFailedDelivery(
  supabase: SupabaseClient,
  input: EnqueueInput
): Promise<{ queued: boolean; error?: string }> {
  const nextAttemptAt = new Date(Date.now() + backoffMinutesForAttempt(0) * 60_000).toISOString();

  try {
    const { error } = await supabase.from('webhook_deliveries').insert({
      business_id: input.businessId,
      payment_id: input.paymentId ?? null,
      escrow_id: input.escrowId ?? null,
      event: input.event,
      webhook_url: input.webhookUrl,
      payload: input.payload ?? {},
      status: 'pending',
      // The in-process attempts already happened; the queue counts its own.
      attempts: 0,
      next_attempt_at: nextAttemptAt,
      last_error: input.lastError ?? null,
      last_status_code: input.lastStatusCode ?? null,
    });

    if (error) {
      console.error('[Webhook] Could not queue failed delivery for retry:', error.message);
      return { queued: false, error: error.message };
    }

    console.warn(
      `[Webhook] Queued ${input.event} for ${input.businessId} after in-process delivery failed; ` +
        `first retry in ${backoffMinutesForAttempt(0)}m`
    );
    return { queued: true };
  } catch (err) {
    console.error('[Webhook] Could not queue failed delivery for retry:', err);
    return { queued: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface RetryQueueStats {
  attempted: number;
  delivered: number;
  rescheduled: number;
  dead: number;
  errors: number;
}

/**
 * Work the queue: retry everything whose backoff has elapsed.
 *
 * @param deliver - performs one delivery. Injected so this module owns the
 *   scheduling and the caller owns the signing and transport, and so the
 *   scheduling is testable without a network.
 */
export async function processWebhookRetryQueue(
  supabase: SupabaseClient,
  deliver: (row: {
    business_id: string;
    event: string;
    webhook_url: string;
    payload: unknown;
  }) => Promise<{ success: boolean; statusCode?: number; error?: string }>,
  opts: { limit?: number } = {}
): Promise<RetryQueueStats> {
  const stats: RetryQueueStats = { attempted: 0, delivered: 0, rescheduled: 0, dead: 0, errors: 0 };
  const limit = opts.limit ?? 100;

  const { data: due, error } = await supabase
    .from('webhook_deliveries')
    .select('id, business_id, event, webhook_url, payload, attempts, max_attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[Webhook] Could not read the retry queue:', error.message);
    stats.errors++;
    return stats;
  }

  if (!due?.length) return stats;

  for (const row of due) {
    stats.attempted++;

    // Claim before delivering, conditioned on the attempt count we read. Two
    // overlapping cron runs would otherwise both deliver the same row, and a
    // duplicate `payment.confirmed` is a real problem for a merchant
    // reconciling against it.
    const attempts = (row.attempts ?? 0) + 1;
    const { data: claimed } = await supabase
      .from('webhook_deliveries')
      .update({
        attempts,
        next_attempt_at: new Date(Date.now() + backoffMinutesForAttempt(attempts) * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('attempts', row.attempts ?? 0)
      .eq('status', 'pending')
      .select('id');

    if (!claimed || claimed.length === 0) continue;

    let result: { success: boolean; statusCode?: number; error?: string };
    try {
      result = await deliver(row);
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (result.success) {
      await supabase
        .from('webhook_deliveries')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          last_status_code: result.statusCode ?? null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      stats.delivered++;
      continue;
    }

    const exhausted = attempts >= (row.max_attempts ?? 8);

    await supabase
      .from('webhook_deliveries')
      .update({
        status: exhausted ? 'dead' : 'pending',
        last_error: result.error ?? 'delivery failed',
        last_status_code: result.statusCode ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (exhausted) {
      stats.dead++;
      // Loud on purpose: this is the point at which the platform gives up on
      // telling a merchant something happened to their money.
      console.error(
        `[Webhook] DEAD-LETTER: ${row.event} for business ${row.business_id} abandoned after ` +
          `${attempts} attempts — last error: ${result.error}`
      );
    } else {
      stats.rescheduled++;
    }
  }

  return stats;
}
