import { createHash, timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison for shared secrets (INTERNAL_API_KEY, CRON_SECRET,
 * webhook signatures, escrow release tokens).
 *
 * `===` on strings short-circuits at the first differing byte, which leaks the
 * length of the matching prefix through timing. That is impractical to exploit
 * across the public internet but trivial from a co-located process, and it is
 * the kind of side channel that gets worse as infrastructure moves closer
 * together. `timingSafeEqual` requires equal-length buffers, so both sides are
 * hashed first — this also stops the comparison itself from leaking length.
 */
export function secretsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  // An absent or blank configured secret must never authenticate anyone. This
  // is checked before any comparison so a missing env var cannot fail open.
  if (!a || !b) return false;
  if (!a.trim() || !b.trim()) return false;

  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * True when `token` matches the configured `INTERNAL_API_KEY`.
 * Returns false when the env var is unset or blank.
 */
export function isInternalApiKey(token: string | null | undefined): boolean {
  return secretsMatch(token, process.env.INTERNAL_API_KEY);
}

/**
 * True when `token` matches `CRON_SECRET`, falling back to `INTERNAL_API_KEY`.
 * Both are compared in constant time and a blank value never matches.
 */
export function isCronSecret(token: string | null | undefined): boolean {
  return secretsMatch(token, process.env.CRON_SECRET) || isInternalApiKey(token);
}
