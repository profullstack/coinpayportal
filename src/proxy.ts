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

function checkRateLimit(
  ip: string,
  isAuth: boolean
): { allowed: boolean; limit: number; remaining: number; resetAt: number } {
  const key = isAuth ? `auth:${ip}` : `api:${ip}`;
  const limit = isAuth ? AUTH_LIMIT : GENERAL_LIMIT;
  const now = Date.now();
  let entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    rateLimitMap.set(key, entry);
  }

  entry.count++;
  const remaining = Math.max(0, limit - entry.count);

  return {
    allowed: entry.count <= limit,
    limit,
    remaining,
    resetAt: entry.resetAt,
  };
}

// ── Proxy ───────────────────────────────────────────────────

/**
 * Security headers + CORS + Rate Limiting proxy
 * Adds OWASP-recommended security headers to all responses,
 * CORS headers to API responses, and rate limiting to API routes.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith('/api/');
  const requestOrigin = request.headers.get('origin');

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
      addSecurityHeaders(response, isApiRoute, requestOrigin);
      const noIpCorsHeaders = getCorsHeaders(requestOrigin);
      if (noIpCorsHeaders['Access-Control-Allow-Origin']) {
        for (const [k, v] of Object.entries(noIpCorsHeaders)) {
          response.headers.set(k, v);
        }
      }
      return response;
    }

    const rl = checkRateLimit(clientIp, isAuthEndpoint);
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
    addSecurityHeaders(response, isApiRoute, requestOrigin);

    // Rate limit headers
    response.headers.set('X-RateLimit-Limit', String(rl.limit));
    response.headers.set('X-RateLimit-Remaining', String(rl.remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)));

    return response;
  }

  const response = NextResponse.next();
  addSecurityHeaders(response, isApiRoute, requestOrigin);
  return response;
}

function addSecurityHeaders(
  response: NextResponse,
  isApiRoute: boolean,
  requestOrigin: string | null
) {
  // Security headers
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  );
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
