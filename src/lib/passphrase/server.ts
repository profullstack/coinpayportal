/**
 * Server half of passphrase sign-in: one-time challenges and decoy salts.
 */
import { createHmac, randomBytes } from 'crypto';
import { DEFAULT_KDF } from './index';

const TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 5000;

type Pending = { challenge: string; email: string; expiresAt: number };
const pending = new Map<string, Pending>();

/**
 * Issue a challenge under a fresh unguessable key (never the merchant id: a
 * shared per-account slot lets anyone who knows the email overwrite a victim's
 * pending challenge, see NEW-07 in webauthn/login-options).
 */
export function issueChallenge(email: string): { challengeKey: string; challenge: string } {
  const now = Date.now();
  if (pending.size >= MAX_PENDING) {
    for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
    if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
  }
  const challengeKey = randomBytes(32).toString('base64url');
  const challenge = randomBytes(32).toString('base64url');
  pending.set(challengeKey, { challenge, email: email.trim().toLowerCase(), expiresAt: now + TTL_MS });
  return { challengeKey, challenge };
}

/** Single use: a consumed or expired key returns null. */
export function consumeChallenge(challengeKey: string): { challenge: string; email: string } | null {
  const entry = pending.get(challengeKey);
  if (!entry) return null;
  pending.delete(challengeKey);
  if (Date.now() > entry.expiresAt) return null;
  return { challenge: entry.challenge, email: entry.email };
}

/**
 * A stable, secret-derived salt for an email with no passphrase, so the
 * options response looks the same whether or not the account exists (and the
 * same on every call, so repeated probes cannot tell a decoy from a real row).
 */
export function decoySalt(email: string): string {
  const secret = process.env.JWT_SECRET || 'coinpay-passphrase-decoy';
  return createHmac('sha256', secret)
    .update(`passphrase-decoy-salt:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

export const DECOY_KDF = DEFAULT_KDF;

/** Test hook. */
export function _resetChallenges(): void {
  pending.clear();
}
