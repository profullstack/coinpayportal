import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── CORS Configuration ──────────────────────────────────────

const ALLOWED_ORIGINS: string[] = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, x-api-key',
    'Access-Control-Max-Age': '86400',
  };

  // If no origins configured, allow all (open API); otherwise validate
  if (ALLOWED_ORIGINS.length === 0) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }

  return headers;
}

/**
 * Security headers + CORS proxy
 * Adds OWASP-recommended security headers to all responses
 * and CORS headers to API responses
 */
export function proxy(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');
  const requestOrigin = request.headers.get('origin');

  // Handle CORS preflight for API routes
  if (isApiRoute && request.method === 'OPTIONS') {
    const corsHeaders = getCorsHeaders(requestOrigin);
    if (!corsHeaders['Access-Control-Allow-Origin']) {
      return new NextResponse(null, { status: 403 });
    }
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const response = NextResponse.next();

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

  // Content-Security-Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://datafa.st",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.infura.io https://api.mainnet-beta.solana.com https://blockstream.info https://polygon-rpc.com https://api.tatum.io https://gasstation.polygon.technology https://datafa.st",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);

  // Add CORS headers to API responses
  if (isApiRoute) {
    const corsHeaders = getCorsHeaders(requestOrigin);
    if (corsHeaders['Access-Control-Allow-Origin']) {
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
    }
  }

  return response;
}

// Apply to all routes except static files and images
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
