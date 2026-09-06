/**
 * Monitor Payments Cron Route
 *
 * GET/POST /api/cron/monitor-payments
 *
 * Background job to monitor pending payments and escrows.
 * Should be called by an external cron service every 15 seconds.
 *
 * Authentication: CRON_SECRET or INTERNAL_API_KEY in Authorization header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { monitorPayments } from './payment-monitor';
import { monitorEscrows } from './escrow-monitor';
import { monitorLightningPayments, syncLnbitsPayments } from './lightning-monitor';
import { monitorSeries } from './series-monitor';
import { monitorEmails } from './email-monitor';
import { runInvoiceMonitorCycle, runInvoiceSchedulerCycle } from '@/lib/payments/monitor-invoices';
import { expireEndedSubscriptions } from '@/lib/subscriptions/service';
import { isCronSecret } from '@/lib/auth/secret-compare';
import { processWebhookRetryQueue } from '@/lib/webhooks/retry-queue';
import { reconcilePaypalTransactions } from '@/lib/paypal/reconcile';
import { redeliverQueuedWebhook, sendPaymentWebhook } from '@/lib/webhooks/service';
import { releaseExpiredAchHolds } from '@/lib/payments/ach-hold';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Reuse a single Supabase client across cron invocations to avoid WebSocket/connection leaks
let _cronSupabase: ReturnType<typeof createClient> | null = null;
function getCronSupabase() {
  if (!_cronSupabase) {
    _cronSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      realtime: { params: { eventsPerSecond: 0 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    _cronSupabase.realtime.disconnect();
  }
  return _cronSupabase;
}

/**
 * Authenticate the cron request.
 *
 * Compared in constant time, and a blank/unset secret never authenticates —
 * `isCronSecret` returns false rather than letting an empty env var match an
 * empty header.
 */
function authenticateRequest(request: NextRequest): boolean {
  if (!process.env.CRON_SECRET && !process.env.INTERNAL_API_KEY) {
    console.error('CRON_SECRET or INTERNAL_API_KEY not configured');
    return false;
  }

  const authHeader = request.headers.get('authorization');
  const providedSecret = authHeader?.replace(/^Bearer /, '').trim();
  return isCronSecret(providedSecret);
}

export async function GET(request: NextRequest) {
  try {
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getCronSupabase();
    const now = new Date();

    // Monitor payments
    const stats = await monitorPayments(supabase, now);

    // Monitor escrows
    const escrowStats = await monitorEscrows(supabase, now);

    // Monitor Lightning payments (LNbits)
    const lightningStats = await monitorLightningPayments(supabase, now);

    // Sync LNbits payments to ln_payments table
    const lnbitsSyncStats = await syncLnbitsPayments(supabase, now);

    // Process recurring escrow series
    const seriesStats = await monitorSeries(supabase, now);

    // Send email notifications
    const emailStats = await monitorEmails(supabase, now);

    // Monitor invoice payments
    const invoiceStats = await runInvoiceMonitorCycle(supabase, now);

    // Process recurring invoice schedules
    const invoiceSchedulerStats = await runInvoiceSchedulerCycle(supabase, now);

    // REC-D-07: work the durable webhook retry queue.
    //
    // In-process delivery spends its whole retry budget inside one request over
    // roughly three seconds, so anything that fails there is handed here and
    // retried on a backoff measured in minutes. Rows that exhaust their budget
    // become dead-letters rather than disappearing.
    const webhookRetryStats = await processWebhookRetryQueue(supabase, (row) =>
      redeliverQueuedWebhook(supabase, row)
    );

    // Finish PayPal orders the payer approved and then abandoned.
    //
    // Capture normally happens on the payer's return leg or on
    // PAYMENT.CAPTURE.COMPLETED. Both can be missing at once: a closed tab
    // removes the first, and webhooks need platform partner credentials, which
    // a merchant using their own credentials does not have. That left an
    // approved order uncaptured and the sale silently lost.
    const paypalReconcile = await reconcilePaypalTransactions(supabase);

    // Release ACH transactions whose hold has run out, and only now tell the
    // merchant they were paid.
    //
    // The webhook is fired here rather than inside releaseExpiredAchHolds
    // because a delivery failure must not roll the release back: the money has
    // settled either way, and an undelivered notification is the retry queue's
    // problem, not a reason to hold the payment for another cycle.
    const releasedAchHolds = await releaseExpiredAchHolds(supabase, now);
    for (const released of releasedAchHolds) {
      if (!released.business_id) continue;
      try {
        await sendPaymentWebhook(
          supabase,
          released.business_id,
          released.id,
          'payment.confirmed',
          {
            status: 'confirmed',
            amount_usd: released.amount ? released.amount / 100 : 0,
            currency: released.currency || 'usd',
            payment_address: null,
            tx_hash: released.stripe_payment_intent_id,
            confirmations: 1,
            metadata: {
              payment_rail: 'ach',
              stripe_payment_intent_id: released.stripe_payment_intent_id,
              ach_hold_released_at: now.toISOString(),
            },
          }
        );
      } catch (err) {
        console.error('[ACH] released hold but failed to notify merchant', released.id, err);
      }
    }

    // Downgrade merchants whose paid period has ended. isPaidTier also checks
    // the end date on every read, so a missed sweep cannot extend a plan — this
    // keeps the stored state honest as well.
    const subscriptionExpiry = await expireEndedSubscriptions(supabase);

    const response = {
      success: true,
      timestamp: now.toISOString(),
      stats,
      escrow: escrowStats,
      lightning: lightningStats,
      lnbits_sync: lnbitsSyncStats,
      series: seriesStats,
      emails: emailStats,
      invoices: invoiceStats,
      invoiceScheduler: invoiceSchedulerStats,
      webhookRetries: webhookRetryStats,
      paypalReconcile,
      subscriptionExpiry,
      achHoldsReleased: releasedAchHolds.length,
    };

    console.log('Monitor complete:', response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Monitor error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Monitor failed' },
      { status: 500 }
    );
  }
}

// Also support POST for flexibility
export async function POST(request: NextRequest) {
  return GET(request);
}
