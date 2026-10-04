/**
 * Nightly Summary Cron Route
 *
 * GET/POST /api/cron/nightly-summary
 *
 * Emails each opted-in merchant what they took in the last 24 hours,
 * overall and per business, busiest first. Call it once a day; call it
 * twice and nobody gets two emails, because `nightly_summary_last_sent_at`
 * gates a resend inside 20 hours.
 *
 * Authentication: CRON_SECRET or INTERNAL_API_KEY in Authorization header,
 * the same as monitor-payments.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronSecret } from '@/lib/auth/secret-compare';
import { sendEmail } from '@/lib/email';
import {
  aggregateNightlySummary,
  renderNightlySummaryEmail,
} from '@/lib/reports/nightly-summary';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** A run sends at most this many, so one slow tick cannot stall the queue. */
const MAX_PER_TICK = 100;
/** Long enough to dedupe a double-fired cron, short enough not to skip a day. */
const RESEND_GUARD_MS = 20 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!isCronSecret(auth.replace(/^Bearer\s+/i, ''))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date();

  const { data: rows, error } = await supabase
    .from('merchant_settings')
    .select('merchant_id, nightly_summary_last_sent_at')
    .eq('nightly_summary_enabled', true)
    .eq('email_notifications', true)
    .limit(MAX_PER_TICK);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of (rows ?? []) as {
    merchant_id: string;
    nightly_summary_last_sent_at: string | null;
  }[]) {
    const lastSentAt = row.nightly_summary_last_sent_at
      ? new Date(row.nightly_summary_last_sent_at)
      : null;
    if (lastSentAt && now.getTime() - lastSentAt.getTime() < RESEND_GUARD_MS) {
      skipped++;
      continue;
    }

    try {
      const summary = await aggregateNightlySummary(supabase, row.merchant_id, now);
      if (!summary) {
        skipped++;
        continue;
      }

      const { subject, html } = renderNightlySummaryEmail(summary);
      const result = await sendEmail({ to: summary.merchantEmail, subject, html });
      if (!result.success) {
        failed++;
        continue;
      }

      // Stamped only after a send actually succeeded, so a provider outage
      // retries on the next tick instead of silently skipping the day.
      await supabase
        .from('merchant_settings')
        .update({ nightly_summary_last_sent_at: now.toISOString() })
        .eq('merchant_id', row.merchant_id);
      sent++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, failed });
}
