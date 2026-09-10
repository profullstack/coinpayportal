import { gate } from "@/lib/crawl-gateway";
import { EXPLORER_PASS_PATH, explorerGate, explorerSell } from "@/lib/explorer-gateway";
import { countExplorerRefusal, watchExplorer } from "@/lib/explorer-watch";
import { meter } from "@/lib/throttle";
import { presentedCredential } from '@profullstack/throttle';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── CORS Configuration ──────────────────────────────────────

// Hardcoded production origins — always allowed regardless of env var
const PRODUCTION_ORIGINS = new Set([
  'https://coinpayportal.com',
  'https://www.coinpayportal.com',
]);

const EXTRA_ORIGINS: string[] = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  return false;
}

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, x-api-key, X-CoinPay-Signature',
    'Access-Control-Max-Age': '86400',
  };

  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers['Vary'] = 'Origin';
  }
  // If no matching origin, don't set Access-Control-Allow-Origin (deny)

  return headers;
}

// ── Rate Limiting ──────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * The per-minute allowance that used to live here -- the anonymous bucket, the
 * auth bucket, the per-credential budget and its host ceiling -- is now
 * @profullstack/throttle, configured in lib/throttle.ts. It differs in one way
 * that matters: it meters every route, not just `/api/`. The scraper that
 * walked 19,000 `/explorer` URLs a day never touched an API path, so none of
 * this code ever saw it.
 *
 * What stays here is the explorer's *daily* accounting, which the package does
 * not express: its windows are minutes, and the cost being controlled below is
 * per page over a day rather than per second.
 */
/**
 * The public block explorer, in three tiers.
 *
 * One page view is one request here but THREE upstream JSON-RPC calls, so the
 * per-minute cap alone was the wrong instrument. At the old 120/min a single
 * IP could still spend 21,600 calls an hour — more than the entire burn that
 * prompted the limit — and the read-through cache does not help, because a
 * client walking distinct transaction hashes misses on every one.
 *
 * So: a burst cap that no reader will ever meet, a free daily allowance, and
 * then payment. A person browsing does not open thirty pages in a minute or
 * two hundred in a day; something that does is a client, and a client can pay
 * for what it costs us.
 */
const EXPLORER_BURST = 30;
const EXPLORER_FREE_PER_DAY = 200;
/**
 * A caller presenting a credential is an integration or an agent rather than a
 * browser, and those legitimately read more. Unverified at this layer, exactly
 * as in the package's credential budget — the ceiling below is what stops it
 * being a way to buy a bigger allowance by inventing a key.
 */
const EXPLORER_CREDENTIALED_PER_DAY = 2_000;
/** What no caller from one host gets past, however many credentials it mints. */
const EXPLORER_IP_PER_DAY = 5_000;
const WINDOW_MS = 60_000; // 1 minute
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Daily buckets live a thousand times longer than per-minute ones, so the
 * sweep below cannot be what bounds this map any more: a spray of addresses
 * would sit in memory for a day. Oldest-reset-first eviction bounds it.
 */
const MAX_RATE_LIMIT_ENTRIES = 50_000;

// Cleanup stale entries every 5 minutes
if (typeof globalThis !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (entry.resetAt <= now) {
        rateLimitMap.delete(key);
      }
    }
  }, 5 * 60_000);
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

/**
 * Drop the entries closest to expiring when the map is full.
 *
 * Only reached once there are more live buckets than any real traffic
 * produces, and it sheds the ones with least life left, so an eviction costs a
 * caller the tail of a window rather than a fresh allowance.
 */
function evictOldest(): void {
  if (rateLimitMap.size < MAX_RATE_LIMIT_ENTRIES) return;
  const victims = [...rateLimitMap.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, Math.ceil(MAX_RATE_LIMIT_ENTRIES / 10));
  for (const [key] of victims) rateLimitMap.delete(key);
}

function bump(key: string, limit: number, now: number, windowMs = WINDOW_MS): RateLimitResult {
  let entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt <= now) {
    evictOldest();
    entry = { count: 0, resetAt: now + windowMs };
    rateLimitMap.set(key, entry);
  }

  entry.count++;

  return {
    allowed: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/** FNV-1a, so a raw API key never becomes a map key we might dump or log. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Re-exported because the credential rule is the same one the package applies,
 * and the tests that pin it -- the wallet extension's `Wallet` scheme, an
 * integration's bearer token -- are worth keeping pointed at the behaviour
 * rather than at a copy. The explorer tiers below use it as a local binding.
 */
export { presentedCredential };

// ── Proxy ───────────────────────────────────────────────────

/**
 * Security headers + CORS + Rate Limiting proxy
 * Adds OWASP-recommended security headers to all responses,
 * CORS headers to API responses, and rate limiting to API routes.
 */
export async function proxy(request: NextRequest) {
  // Crawl gateway first: AI training crawlers get 402 Payment Required (or the
  // sales page at /crawl) unless they present a paid pass. People, Googlebot
  // and retrieval crawlers fall through to everything below.
  const answer = await gate(request);
  if (answer) return answer;

  /*
   * Then the site-wide allowance, which meters every route: 100 requests a
   * minute per caller, and going over is answered with the same offer the gate
   * makes rather than a bare 429. Before CORS and the security headers,
   * because there is no point dressing a response we are about to refuse.
   *
   * The explorer's own tiers below are stricter and settle a different
   * question -- how much a caller may read in a day, not in a minute -- so
   * they still bind for `/explorer` after this has let a request through.
   */
  /*
   * Counted before the throttle decides, so a refused request is still counted.
   * A limit that hides the traffic it is turning away cannot be tuned against
   * anything -- and this is the count that will say whether the explorer scrape
   * is one caller or fifty. See lib/explorer-watch.ts.
   */
  if (request.nextUrl.pathname.startsWith("/explorer/")) watchExplorer(request);

  const overLimit = await meter(request);
  if (overLimit) return overLimit;

  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith('/api/');
  const requestOrigin = request.headers.get('origin');
  // The Tor hidden service listens on plain HTTP (HiddenServicePort 80 -> app).
  // Tor Browser treats .onion as a secure origin and will CACHE an HSTS policy
  // received here, then force every future request to https://<onion> — which
  // has no TLS listener, so the site "won't load". Never emit HSTS on the onion.
  const host = request.headers.get('host') ?? '';
  const isOnion = host.endsWith('.onion');

  // Handle CORS preflight for API routes
  if (isApiRoute && request.method === 'OPTIONS') {
    const corsHeaders = getCorsHeaders(requestOrigin);
    if (!corsHeaders['Access-Control-Allow-Origin']) {
      return new NextResponse(null, { status: 403 });
    }
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  // Rate limiting for the public block explorer.
  //
  // This block sits before the API one because the guard below it is
  // `pathname.startsWith('/api/')`, and /explorer is a *page* route — so it
  // was never rate limited at all, by anything. It is also unauthenticated by
  // design (a block explorer has no login) and rendered `force-dynamic`, and
  // every transaction page costs three upstream JSON-RPC calls against our
  // paid Infura endpoints. That combination is a free, metered, public RPC
  // proxy, and it was being used as one.
  //
  // A per-minute cap alone was the wrong instrument, because the cost is per
  // page and not per second: at the old 120/min one address could still spend
  // 21,600 upstream calls an hour without ever being refused. The tiers below
  // cap the burst, give a day's reading away, and then ask whoever is still
  // going to pay for it — see EXPLORER_BURST and src/lib/explorer-gateway.ts.
  //
  // The sales page is excluded, or the only page that explains the charge
  // would itself be behind it.
  // The page that explains the charge and takes the payment.
  if (pathname === EXPLORER_PASS_PATH) {
    return await explorerSell(request);
  }

  if (pathname.startsWith('/explorer') && pathname !== EXPLORER_PASS_PATH) {
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;

    if (clientIp) {
      const now = Date.now();
      const burst = bump(`explorer:${clientIp}`, EXPLORER_BURST, now);
      if (!burst.allowed) {
        const retryAfter = Math.ceil((burst.resetAt - now) / 1000);
        /*
         * Refusals were silent, which cost us two days of guessing. The tiers
         * here were demonstrably live and refusing while the scrape carried on
         * at the same rate, and nothing recorded either half of that, so there
         * was no way to tell "the limit is not working" from "the limit is
         * working and this caller is not the one hitting it".
         */
        countExplorerRefusal('burst');
        return new NextResponse('Too many requests', {
          status: 429,
          headers: {
            'Content-Type': 'text/plain',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(burst.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(burst.resetAt / 1000)),
          },
        });
      }

      // Both buckets are charged, and the host ceiling wins a disagreement:
      // the per-credential allowance is the generous one, so it must not be
      // reachable simply by presenting a different unverified key each day.
      const credential = presentedCredential(request.headers);
      const daily = credential
        ? bump(`explorer-day:${fingerprint(credential)}`, EXPLORER_CREDENTIALED_PER_DAY, now, DAY_MS)
        : bump(`explorer-day:${clientIp}`, EXPLORER_FREE_PER_DAY, now, DAY_MS);
      const ceiling = bump(`explorer-day-ip:${clientIp}`, EXPLORER_IP_PER_DAY, now, DAY_MS);

      if (!daily.allowed || !ceiling.allowed) {
        // Over the allowance: the gateway answers with a 402 and an offer, or
        // with the sales page for a browser — unless this caller already holds
        // a pass or is settling a payment right now, in which case it returns
        // null and the request carries on as any other.
        const answer = await explorerGate(request);
        if (answer) {
          countExplorerRefusal(daily.allowed ? 'ip-ceiling' : 'daily');
          return answer;
        }
      }
    }
  }

  const response = NextResponse.next();
  addSecurityHeaders(response, isApiRoute, requestOrigin, isOnion);
  return response;
}

function addSecurityHeaders(
  response: NextResponse,
  isApiRoute: boolean,
  requestOrigin: string | null,
  isOnion: boolean
) {
  // HSTS only makes sense over HTTPS. The onion is served over plain HTTP, and
  // emitting HSTS there makes Tor Browser force-upgrade to a non-existent
  // https://<onion> and fail to load. Skip it for .onion hosts.
  if (!isOnion) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  );

  // CSP is configured in next.config.mjs headers() to avoid duplication.
  // Do not set Content-Security-Policy here.

  // Add CORS headers to API responses
  if (isApiRoute) {
    const corsHeaders = getCorsHeaders(requestOrigin);
    if (corsHeaders['Access-Control-Allow-Origin']) {
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
    }
  }
}

// Apply to all routes except static files and images
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
