#!/usr/bin/env npx tsx
/**
 * Daily Stats Email for CoinPayPortal: manual run.
 *
 * The scheduled run is the app's own cron route, POST /api/cron/daily-stats
 * (x-cron-secret: $CRON_SECRET), so it reads the production database with the
 * production keys and sends through the app's own mailer. Do not schedule this
 * script from another box: until 2026-09-29 it ran from a DigitalOcean droplet
 * with its own .env, whose Mailgun key had been revoked (every send a 401) and
 * whose Supabase URL was the cloud project the site left on 2026-09-25.
 *
 * Usage (env from the vault / the app env, not a .env file):
 *   npx tsx scripts/daily-stats-email.ts                    # send to the default
 *   npx tsx scripts/daily-stats-email.ts --to me@example.com
 *   npx tsx scripts/daily-stats-email.ts --dry-run          # print, don't send
 *
 * Exits non-zero, and sends nothing, if any count fails.
 */

import { createClient } from '@supabase/supabase-js';
import {
  collectDailyStats,
  renderDailyStats,
  sendDailyStatsEmail,
  DAILY_STATS_TO,
} from '../src/lib/reports/daily-stats';

const DRY_RUN = process.argv.includes('--dry-run');
const toArg = process.argv.findIndex((a) => a === '--to');
const TO_EMAIL = toArg >= 0 && process.argv[toArg + 1] ? process.argv[toArg + 1] : DAILY_STATS_TO;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

  console.log(`Building CoinPayPortal daily stats report from ${new URL(url).host}...`);
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const report = renderDailyStats(await collectDailyStats(supabase));

  if (DRY_RUN) {
    console.log(`\nSubject: ${report.subject}\nTo: ${TO_EMAIL}\n`);
    console.log(report.text);
    console.log('\n(dry run: email not sent)');
    return;
  }

  console.log(`Sending to ${TO_EMAIL}...`);
  const id = await sendDailyStatsEmail(report, TO_EMAIL);
  console.log(`Sent. ID: ${id ?? '(unknown)'}`);
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
