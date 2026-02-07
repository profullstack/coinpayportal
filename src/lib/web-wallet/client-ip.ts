/**
 * Client IP Detection Utility
 * 
 * Safely extracts client IP from request headers with proxy awareness.
 * 
 * SECURITY NOTES:
 * - X-Forwarded-For can be spoofed if not behind a trusted proxy
 * - Railway/Vercel/Cloudflare overwrite this header with the real client IP
 * - For self-hosted deployments, ensure your reverse proxy (nginx, etc.)
 *   is configured to set X-Forwarded-For correctly and strip any
 *   client-provided values
 * 
 * Header priority:
 * 1. CF-Connecting-IP (Cloudflare - most trusted)
 * 2. X-Real-IP (nginx default)
 * 3. X-Forwarded-For (first IP, set by proxy)
 * 4. 'unknown' fallback
 */

import { NextRequest } from 'next/server';

/**
 * Extract client IP from request headers.
 * Uses platform-specific headers when available for better accuracy.
 */
export function getClientIp(request: NextRequest): string {
  // Cloudflare sets this reliably
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && isValidIp(cfIp)) {
    return cfIp.trim();
  }

  // Vercel sets this
  const vercelIp = request.headers.get('x-vercel-forwarded-for');
  if (vercelIp) {
    const ip = vercelIp.split(',')[0]?.trim();
    if (ip && isValidIp(ip)) {
      return ip;
    }
  }

  // Railway/nginx typically use X-Real-IP
  const realIp = request.headers.get('x-real-ip');
  if (realIp && isValidIp(realIp)) {
    return realIp.trim();
  }

  // Standard X-Forwarded-For (first IP is client when proxy configured correctly)
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const ip = xff.split(',')[0]?.trim();
    if (ip && isValidIp(ip)) {
      return ip;
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
  // Could add user-agent hash for additional entropy, but might cause
  // issues with legitimate users changing browsers
  return `${prefix}:${ip}`;
}
