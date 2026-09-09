import { gate } from "@/lib/crawl-gateway";
import { meter } from "@/lib/throttle";
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

/**
 * The limiter that used to live here is now @profullstack/throttle, configured
 * in lib/throttle.ts. It differs in one way that matters: it meters every
 * route, not just `/api/`. The scraper that walked 19,000 `/explorer` URLs a
 * day never touched an API path, so none of this code ever saw it.
 *
 * Re-exported because the credential rule is the same one, and the tests that
 * pin it -- the wallet extension's `Wallet` scheme, an integration's bearer
 * token -- are worth keeping pointed at the behaviour rather than at a copy.
 */
export { presentedCredential } from '@profullstack/throttle';

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
   * minute per caller, and going over is answered 402 with the same offer the
   * gate makes rather than 429. Before CORS and the security headers, because
   * there is no point dressing a response we are about to refuse.
   */
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
