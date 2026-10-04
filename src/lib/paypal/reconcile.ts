import type { SupabaseClient } from '@supabase/supabase-js';
import { getPaypalOrder, capturePaypalOrder } from './client';
import { resolvePaypalContext } from './accounts';
import { settlePaypalCapture, type PaypalTransactionRow } from './settle';

/**
 * Finishing PayPal payments nobody came back for.
 *
 * A PayPal order is captured either when the payer returns to
 * `/pay/paypal/return` or when `PAYMENT.CAPTURE.COMPLETED` arrives. Both can be
 * absent at once:
 *
 *  - the payer approves on PayPal and closes the tab, so there is no return leg;
 *  - and webhooks need platform partner credentials to verify, so a merchant
 *    connected with their OWN credentials gets no webhook at all.
 *
 * That combination leaves an order APPROVED at PayPal and `pending` here.
 * Nobody is charged — capture never happened — but the sale is silently lost.
 *
 * This sweep closes that hole for both connection modes by asking PayPal what
 * actually happened to each stale order, and is a safety net for ordinary
 * webhook failures too. It runs from the per-minute cron cycle.
 */

/** Don't touch an order the payer may still be completing in another tab. */
const DEFAULT_MIN_AGE_MINUTES = 10;

/**
 * PayPal expires an unapproved order after roughly three hours. Past this we
 * stop asking and mark it expired, so the sweep's working set stays small
 * instead of growing forever with checkouts nobody ever started.
 */
const DEFAULT_MAX_AGE_HOURS = 6;

/** Bounded so one cycle cannot run long or hammer PayPal. */
const DEFAULT_LIMIT = 25;

export interface ReconcileOptions {
  minAgeMinutes?: number;
  maxAgeHours?: number;
  limit?: number;
}

export interface ReconcileStats {
  examined: number;
  /** Payer had approved; we captured and settled it. */
  captured: number;
  /** PayPal had already captured it; we settled from what PayPal reported. */
  settled: number;
  /** Too old and never approved. */
  expired: number;
  /** Still legitimately in flight, or PayPal could not be reached. */
  skipped: number;
  errors: number;
}

const COLUMNS = `id, business_id, merchant_id, amount, currency, status, invoice_number,
   customer_email, platform_fee_amount, paypal_order_id, created_at`;

/**
 * Sweep stale pending/approved PayPal transactions and finish whatever PayPal
 * says is finishable.
 *
 * Every outcome routes through `settlePaypalCapture`, so a row this sweep
 * settles is indistinguishable from one the webhook settled — same fee maths,
 * same merchant webhook, same idempotency guard. If the real webhook lands while
 * this is mid-flight, one of them matches zero rows and stops.
 */
export async function reconcilePaypalTransactions(
  supabase: SupabaseClient,
  options: ReconcileOptions = {}
): Promise<ReconcileStats> {
  const minAge = options.minAgeMinutes ?? DEFAULT_MIN_AGE_MINUTES;
  const maxAge = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const stats: ReconcileStats = {
    examined: 0,
    captured: 0,
    settled: 0,
    expired: 0,
    skipped: 0,
    errors: 0,
  };

  const now = Date.now();
  const staleBefore = new Date(now - minAge * 60_000).toISOString();
  const expireBefore = new Date(now - maxAge * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from('paypal_transactions')
    .select(COLUMNS)
    .in('status', ['pending', 'approved'])
    .lt('created_at', staleBefore)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[PayPal reconcile] Could not list stale transactions:', error);
    return stats;
  }

  for (const row of (data || []) as unknown as (PaypalTransactionRow & { created_at: string })[]) {
    stats.examined++;

    // Orders whose creation failed before PayPal ever saw them keep the
    // placeholder id. There is nothing at PayPal to ask about.
    if (!row.paypal_order_id || row.paypal_order_id.startsWith('pending:')) {
      if (row.created_at < expireBefore) {
        await markExpired(supabase, row.id);
        stats.expired++;
      } else {
        stats.skipped++;
      }
      continue;
    }

    if (!row.business_id) {
      stats.skipped++;
      continue;
    }

    try {
      const context = await resolvePaypalContext(supabase, row.business_id);
      if ('error' in context) {
        // Merchant disconnected PayPal while this was in flight. We can no
        // longer ask, so age it out rather than retrying forever.
        if (row.created_at < expireBefore) {
          await markExpired(supabase, row.id, 'PayPal was disconnected before this payment completed');
          stats.expired++;
        } else {
          stats.skipped++;
        }
        continue;
      }

      const callArgs = {
        ...context.creds,
        ...context.callContext,
        orderId: row.paypal_order_id,
      };

      const order = await getPaypalOrder(callArgs);

      // Already captured at PayPal — the webhook was lost or never sent.
      if (order.status === 'COMPLETED') {
        const result = await settlePaypalCapture(supabase, row, order);
        if (result.settled) stats.settled++;
        else if (result.alreadySettled) stats.skipped++;
        else stats.errors++;
        continue;
      }

      // The payer approved and left. This is the case the sweep exists for:
      // capture now so the merchant is actually paid.
      if (order.status === 'APPROVED') {
        const capture = await capturePaypalOrder(callArgs);
        const result = await settlePaypalCapture(supabase, row, capture);
        if (result.settled) stats.captured++;
        else if (result.alreadySettled) stats.skipped++;
        else stats.errors++;
        continue;
      }

      // CREATED / SAVED / PAYER_ACTION_REQUIRED — never approved. Give the payer
      // the full window, then stop tracking it.
      if (row.created_at < expireBefore) {
        await markExpired(supabase, row.id);
        stats.expired++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';

      // PayPal drops orders it has expired; there is nothing left to reconcile.
      if (/RESOURCE_NOT_FOUND|ORDER_NOT_FOUND|404/i.test(message)) {
        await markExpired(supabase, row.id, 'PayPal no longer has this order');
        stats.expired++;
        continue;
      }

      // A transient PayPal error must not burn the row — leave it pending and
      // try again next cycle.
      console.error(`[PayPal reconcile] ${row.id} failed:`, message);
      stats.errors++;
    }
  }

  if (stats.captured || stats.settled || stats.expired || stats.errors) {
    console.log('[PayPal reconcile]', stats);
  }

  return stats;
}

async function markExpired(
  supabase: SupabaseClient,
  id: string,
  reason = 'Payer did not complete the PayPal checkout'
): Promise<void> {
  // Guarded so a payment that completed between the read and this write is
  // never walked backwards into expired.
  await supabase
    .from('paypal_transactions')
    .update({
      status: 'expired',
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['pending', 'approved']);
}
