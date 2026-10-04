#!/usr/bin/env node
/**
 * Railway cron entrypoint for the nightly payment summary.
 *
 * Railway cron runs a service's start command on a schedule and expects the
 * process to exit, so this is a one-shot: call the endpoint, print what it
 * did, exit. Point a cron service at it with
 *   Start command: node scripts/nightly-summary-cron.mjs
 *   Cron schedule: 0 9 * * *
 *
 * Env:
 *   NIGHTLY_SUMMARY_URL  full URL of the route; defaults to the public site
 *   CRON_SECRET          same secret the route checks
 *
 * Exits non-zero on failure so a failed run is visible in Railway rather
 * than a green tick over a silent 401.
 */

const url =
  process.env.NIGHTLY_SUMMARY_URL ??
  `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://coinpayportal.com'}/api/cron/nightly-summary`;

const secret = process.env.CRON_SECRET ?? process.env.INTERNAL_API_KEY;
if (!secret) {
  console.error('nightly-summary: CRON_SECRET is not set; refusing to call the route unauthenticated.');
  process.exit(1);
}

// A cold Next.js instance plus a few hundred merchants is slower than the
// default fetch timeout in some runtimes; be explicit rather than hopeful.
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    signal: controller.signal,
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`nightly-summary: ${response.status} ${body.slice(0, 300)}`);
    process.exit(1);
  }

  console.log(`nightly-summary: ${body.slice(0, 300)}`);
} catch (error) {
  console.error(`nightly-summary: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
