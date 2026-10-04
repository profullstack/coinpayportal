/**
 * Daily Stats Cron Route
 *
 * POST /api/cron/daily-stats            computes the report and emails it
 * POST /api/cron/daily-stats?dry_run=1  returns the counts as JSON, sends nothing
 *
 * The CoinPayPortal daily report (08:00 UTC, to anthony@profullstack.com).
 * It runs inside the app so it reads the same database, with the same keys,
 * and sends through the same mailer as the site. It used to be
 * scripts/daily-stats-email.ts run from a DigitalOcean droplet with its own
 * .env: a revoked Mailgun key (every send a 401) and the Supabase cloud
 * project the site left on 2026-09-25.
 *
 * Any query failure, or an empty core table, is a 500 and NO email goes out.
 *
 * Authentication: CRON_SECRET (or INTERNAL_API_KEY) as `Authorization: Bearer`
 * or `x-cron-secret`, compared in constant time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronSecret } from '@/lib/auth/secret-compare';
import { createServiceClient } from '@/lib/supabase/service-client';
import {
  collectDailyStats,
  renderDailyStats,
  sendDailyStatsEmail,
} from '@/lib/reports/daily-stats';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token =
    request.headers.get('x-cron-secret') ||
    (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!isCronSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';

  let stats;
  try {
    stats = await collectDailyStats(createServiceClient());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[daily-stats] not sent:', message);
    return NextResponse.json({ error: message, sent: false }, { status: 500 });
  }

  const report = renderDailyStats(stats);
  if (dryRun) {
    return NextResponse.json({ sent: false, dry_run: true, subject: report.subject, stats });
  }

  try {
    const id = await sendDailyStatsEmail(report);
    console.log(`[daily-stats] sent "${report.subject}" (${id ?? 'no id'})`);
    return NextResponse.json({ sent: true, id, subject: report.subject });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[daily-stats] send failed:', message);
    return NextResponse.json({ error: message, sent: false }, { status: 502 });
  }
}
