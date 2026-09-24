/**
 * Charging the traffic that is a browser but is not a reader.
 *
 * The scrape that prompted this was 95.8% of the site's reported HUMAN
 * traffic: 152,131 hits in a month from one Singapore cloud region, against
 * 267 that resolved to the city of Singapore. Country resolves, city does not,
 * which is what a datacenter allocation looks like in a geo database.
 *
 * It runs a real headless Chromium, so it sends Sec-Fetch-Mode, renders the
 * page and fires the analytics beacon. Every user-agent and header check we
 * have passes it, because it is not lying about being a browser. The only
 * thing it cannot dress up is the address it comes from — and AWS, GCP and
 * DigitalOcean each publish their address space, so that is knowable exactly
 * without an IP reputation service and without storing anyone's address.
 *
 * It ASKS FOR MONEY, it does not refuse. A datacenter address is not
 * misconduct: agents, integrations and corporate egress all live there. 402
 * is a question a caller can answer; 403 is not.
 *
 * ── What is never charged, and why each one matters ──────────────────────
 *
 *   /api/*           Integrations, webhooks (Stripe, Column, Plaid) and the
 *                    x402 endpoints themselves all arrive here from cloud
 *                    addresses by nature. Charging them breaks paying
 *                    customers and our own money rails.
 *   No client IP     An internal caller: Railway's healthcheck, container to
 *                    container. Railway runs ON a cloud, so without this the
 *                    healthcheck on `/` would be answered 402, the deploy
 *                    would be marked unhealthy and every future deploy would
 *                    fail. Absent evidence is never treated as guilt.
 *   Signed in        They already pay us.
 *   Search crawlers  Googlebot and the retrieval half send readers back.
 *                    Charging them de-indexes the site, which costs far more
 *                    than the pages they read.
 *
 * ── Off by default ───────────────────────────────────────────────────────
 *
 * `CLOUD_CHARGE=pages` turns it on. This can answer a real customer with a
 * payment demand if a rule is wrong, on the live payment platform, so it ships
 * inert and is switched on deliberately with the logs watched — not enabled by
 * the act of merging it.
 */

import { createCloudMatcher } from '@profullstack/footprint/cloud';

/** How often the published range files are re-read. They change rarely. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Every region, not just Singapore.
 *
 * Singapore is where this one sits today and a region filter would be a rule
 * about one operator rather than about the behaviour. Anyone running the same
 * thing from Frankfurt is doing the same thing.
 */
const matcher = createCloudMatcher({ providers: ['aws', 'gcp', 'digitalocean'] });

let refreshing: Promise<unknown> | null = null;
let nextRefresh = 0;

/**
 * Kick a refresh if the list is stale, WITHOUT making the caller wait.
 *
 * The files are megabytes. A request must never block on downloading them, so
 * this returns immediately and the current request is judged against whatever
 * is loaded — which, before the first refresh completes, is an empty list that
 * matches nobody. Erring toward serving is the correct direction for a gate
 * that charges money.
 */
function ensureFresh(): void {
  const now = Date.now();
  if (refreshing || now < nextRefresh) return;
  nextRefresh = now + REFRESH_MS;
  refreshing = matcher
    .refresh()
    .then((r) => {
      console.log(`[cloud-gate] ${r.size} ranges loaded${r.failed.length ? ` (failed: ${r.failed.join('; ')})` : ''}`);
    })
    .catch((err) => {
      // Never throw into a request path. A stale or empty list charges nobody.
      console.error('[cloud-gate] refresh failed:', err?.message ?? err);
    })
    .finally(() => {
      refreshing = null;
    });
}

/** Crawlers that send readers back. Never charged. */
const SEARCH_CRAWLER = /googlebot|bingbot|duckduckbot|applebot|yandex|baiduspider|slurp|oai-searchbot|chatgpt-user|perplexitybot|claude-searchbot|claude-user/i;

function isSignedIn(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? '';
  return /sb-[^=]*auth-token=/.test(cookie) || /coinpay_session=/.test(cookie);
}

/** The forwarded client address, or null when there is none to judge. */
export function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || null;
}

export type CloudVerdict = { charge: false; reason: string } | { charge: true; ip: string };

/**
 * Whether this request should be asked to pay because of where it came from.
 *
 * Returns a reason either way so a refusal can be explained and a pass can be
 * audited: "why was this charged" must never be answered with a shrug.
 */
export function judgeCloudClient(request: Request, pathname: string): CloudVerdict {
  if ((process.env.CLOUD_CHARGE ?? 'off') !== 'pages') return { charge: false, reason: 'disabled' };

  ensureFresh();

  if (pathname.startsWith('/api/')) return { charge: false, reason: 'api route' };

  const ip = clientAddress(request);
  if (!ip) return { charge: false, reason: 'no client address (internal)' };

  const ua = request.headers.get('user-agent') ?? '';
  if (SEARCH_CRAWLER.test(ua)) return { charge: false, reason: 'search crawler' };
  if (isSignedIn(request)) return { charge: false, reason: 'signed in' };

  if (!matcher.matches(ip)) return { charge: false, reason: 'not a published cloud range' };

  return { charge: true, ip };
}

/** For the operational log line: how much of the list is loaded. */
export function cloudGateStatus() {
  return { ranges: matcher.size, lastRefresh: matcher.lastRefresh, lastError: matcher.lastError };
}
