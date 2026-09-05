import { gate } from "@/lib/crawl-gateway";
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

const GENERAL_LIMIT = 60;
const AUTH_LIMIT = 10;
/**
 * Server-to-server integrations arrive from one host, so an IP bucket sized for
 * a single browser throttles a whole merchant. ugig.net minting payment
 * requests for its accepted-invoice queue sends ~80 creates in a burst and got
 * "Too many requests" partway through, which surfaced to the payer as invoices
 * that silently would not prepare. Credentialed callers get their own bucket.
 */
const API_KEY_LIMIT = 600;
/**
 * The credential above is unverified at this layer — the route handler is what
 * actually authenticates it. So a caller could mint buckets by rotating junk
 * keys; this ceiling bounds that per host while staying far above any real
 * integration's burst.
 */
const API_KEY_IP_CEILING = 1200;
const WINDOW_MS = 60_000; // 1 minute

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

function bump(key: string, limit: number, now: number): RateLimitResult {
  let entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
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

/** The credential presented, if any. Unverified here — the route handler authenticates. */
export function presentedCredential(
  headers: { get(name: string): string | null }
): string | null {
  const authorization = headers.get('authorization');
  if (authorization) {
    // Any auth scheme, not just Bearer. The wallet extension signs with
    // `Authorization: Wallet <walletId>:<signature>:<timestamp>` (see
    // packages/extension/src/core/api.ts), and matching Bearer alone dropped it
    // into the anonymous per-IP bucket — which a bulk payout exhausts in
    // seconds, since every payment costs a prepare-tx plus a broadcast.
    const match = /^(\S+)\s+(\S+)/.exec(authorization.trim());
    if (match) return match[2];
  }
  const apiKey = headers.get('x-api-key')?.trim();
  return apiKey ? apiKey : null;
}

function checkRateLimit(
  ip: string,
  isAuth: boolean,
  credential: string | null
): RateLimitResult {
  const now = Date.now();

  // Auth endpoints stay IP-bucketed whatever headers accompany them, or a
  // brute-force attempt would just bolt on an Authorization header to buy a
  // bigger budget.
  if (isAuth) return bump(`auth:${ip}`, AUTH_LIMIT, now);

  if (!credential) return bump(`api:${ip}`, GENERAL_LIMIT, now);

  // Both buckets are charged; the host ceiling is what a key-rotating caller
  // cannot escape, so a denial there wins over a healthy per-key budget.
  const ceiling = bump(`apikey-ip:${ip}`, API_KEY_IP_CEILING, now);
  const perKey = bump(`apikey:${fingerprint(credential)}`, API_KEY_LIMIT, now);
  return ceiling.allowed ? perKey : ceiling;
}

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

  // Rate limiting for API routes
  if (isApiRoute) {
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;
    const isAuthEndpoint = pathname.startsWith('/api/auth/');

    // Skip rate limiting if we can't identify the client
    if (!clientIp) {
      const response = NextResponse.next();
      addSecurityHeaders(response, isApiRoute, requestOrigin, isOnion);
      const noIpCorsHeaders = getCorsHeaders(requestOrigin);
      if (noIpCorsHeaders['Access-Control-Allow-Origin']) {
        for (const [k, v] of Object.entries(noIpCorsHeaders)) {
          response.headers.set(k, v);
        }
      }
      return response;
    }

    const rl = checkRateLimit(
      clientIp,
      isAuthEndpoint,
      presentedCredential(request.headers)
    );
    const corsHeaders = getCorsHeaders(requestOrigin);

    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return new NextResponse(
        JSON.stringify({ success: false, error: 'Too many requests' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(rl.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
            ...corsHeaders,
          },
        }
      );
    }

    const response = NextResponse.next();

    // Security headers
    addSecurityHeaders(response, isApiRoute, requestOrigin, isOnion);

    // Rate limit headers
    response.headers.set('X-RateLimit-Limit', String(rl.limit));
    response.headers.set('X-RateLimit-Remaining', String(rl.remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)));

    return response;
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
