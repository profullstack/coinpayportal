import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 webhook signatures, shared by the adapters.
 *
 * Always over the RAW body exactly as it arrived. Re-serialising a parsed
 * object produces different bytes the moment the sender's serialiser disagrees
 * with ours about spacing or key order (see src/lib/remittance/transfi-webhook.ts).
 */
export function hmacSha256Hex(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/** Constant-time compare of a received hex signature against the expected one. */
export function verifyHmacSha256Hex(
  rawBody: string,
  received: string | null | undefined,
  secret: string,
): boolean {
  if (!received || !secret) return false;
  const expected = hmacSha256Hex(rawBody, secret);
  const got = received.trim().toLowerCase();
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}
