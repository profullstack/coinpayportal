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
      subscriptionExpiry,
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
