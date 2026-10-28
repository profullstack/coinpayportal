import { createHash, timingSafeEqual } from 'crypto';

/**
 * Bearer tokens we only ever VERIFY are stored as a SHA-256 hash, never as
 * the token itself (2026-10-28). A row read from the database (backup, SQL
 * injection, a rooted box) then cannot be replayed.
 *
 * Stored form: `sha256:<64 hex>`. The tokens are 256-bit random values, so an
 * unsalted fast hash is the right tool: there is nothing to brute-force, and
 * a deterministic hash keeps the lookup an indexed equality match.
 *
 * Legacy rows still hold the raw token until the migration hashes them in
 * place. `storedTokenMatches` accepts both, and refuses a presented value that
 * is itself in hash form, so a leaked hash can never be replayed as a token
 * against a legacy-compare path.
 */

export const TOKEN_HASH_PREFIX = 'sha256:';

export function hashToken(token: string): string {
  return TOKEN_HASH_PREFIX + createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isHashedToken(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && /^sha256:[0-9a-f]{64}$/.test(stored);
}

/** A presented token that looks like a stored hash is never a real token. */
export function isPresentableToken(presented: string): boolean {
  return presented.length > 0 && !presented.startsWith(TOKEN_HASH_PREFIX);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Constant-time check of a presented bearer against a stored (hashed or legacy raw) value. */
export function storedTokenMatches(stored: string | null | undefined, presented: string): boolean {
  if (!stored || !isPresentableToken(presented)) return false;
  if (isHashedToken(stored)) return constantTimeEqual(stored, hashToken(presented));
  return constantTimeEqual(stored, presented);
}
