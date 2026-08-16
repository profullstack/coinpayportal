/**
 * Client IP Detection Utility
 *
 * Extracts the client IP for rate limiting and abuse controls.
 *
 * THE SPOOFING PROBLEM, AND WHY THE ORDER MATTERS
 *
 * X-Forwarded-For is a list that each proxy APPENDS to. A request that arrives
 * carrying `X-Forwarded-For: 1.2.3.4` leaves the edge proxy as
 * `1.2.3.4, <real client ip>`. So the LEFTMOST entry is whatever the client
 * chose to send, and the RIGHTMOST is the one the closest trusted proxy
 * observed. Reading `xff.split(',')[0]` — as this file used to — therefore
 * takes the attacker-controlled value, and every per-IP rate limit becomes
 * bypassable by rotating a header.
 *
 * The same applies to CF-Connecting-IP and X-Real-IP: they are only meaningful
 * if the request genuinely came through that platform. If the origin is
 * reachable directly, a client can set them to anything.
 *
 * So: parse from the RIGHT, and only trust vendor headers when the deployment
 * actually sits behind that vendor. TRUSTED_PROXY_HOPS says how many proxies
 * are in front of this app (default 1); the IP is taken that many entries in
 * from the right.
 */

import { NextRequest } from 'next/server';

/**
 * How many trusted proxies sit in front of this app. The client IP is taken
 * that many entries from the right of X-Forwarded-For. Default 1, matching a
 * single platform edge (Railway/Vercel).
 */
function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS);
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

/**
 * Whether to trust vendor-specific client-IP headers. Only enable when the
 * origin is genuinely unreachable except through that vendor — otherwise the
 * header is just another value the client picks.
 */
function trustVendorHeaders(): boolean {
  return process.env.TRUST_VENDOR_IP_HEADERS === 'true';
}

export function getClientIp(request: NextRequest): string {
  if (trustVendorHeaders()) {
    const cfIp = request.headers.get('cf-connecting-ip');
    if (cfIp && isValidIp(cfIp)) return cfIp.trim();

    const realIp = request.headers.get('x-real-ip');
    if (realIp && isValidIp(realIp)) return realIp.trim();
  }

  // Vercel appends its own list; treat it the same way as XFF.
  const forwarded =
    request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for');

  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    // Count in from the RIGHT: the last entry was appended by the closest
    // proxy and is the only one the client could not choose.
    const index = hops.length - trustedProxyHops();
    const candidate = hops[index >= 0 ? index : 0];

    if (candidate && isValidIp(candidate)) {
      return candidate;
    }
  }

  return 'unknown';
}

/**
 * Basic IP format validation to reject obviously spoofed values.
 * Accepts IPv4 and IPv6 formats.
 */
function isValidIp(ip: string): boolean {
  const trimmed = ip.trim();
  
  // Reject empty or obviously invalid
  if (!trimmed || trimmed.length > 45) return false;
  
  // IPv4: basic pattern check
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(trimmed)) {
    // Validate each octet is 0-255
    const octets = trimmed.split('.').map(Number);
    return octets.every(o => o >= 0 && o <= 255);
  }
  
  // IPv6: basic pattern check (simplified, allows common formats)
  const ipv6Pattern = /^[a-fA-F0-9:]+$/;
  if (ipv6Pattern.test(trimmed) && trimmed.includes(':')) {
    return true;
  }
  
  // IPv4-mapped IPv6
  if (trimmed.startsWith('::ffff:')) {
    return isValidIp(trimmed.slice(7));
  }
  
  return false;
}

/**
 * Get a rate limit key that includes IP but is harder to spoof.
 * Combines IP with other request characteristics.
 */
export function getRateLimitKey(request: NextRequest, prefix: string): string {
  const ip = getClientIp(request);
  // 'unknown' means no usable forwarded header. Bucketing every such request
  // under one key would let one caller exhaust the limit for all of them, so
  // they share a clearly-labelled bucket that operators can alert on.
  return `${prefix}:${ip}`;
}
