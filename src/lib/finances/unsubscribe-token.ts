import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { requireEncryptionKey } from '../crypto/require-key';

/**
 * Signed one-click unsubscribe tokens for finance emails.
 *
 * The token names the merchant, the schedule kind and the recipient it was
 * sent to, and is signed with HMAC-SHA256, so anyone holding the email can
 * unsubscribe that one address without logging in, and nobody can forge one
 * for another merchant or another address. No expiry: an unsubscribe link in
 * a year-old email must still work.
 *
 * The key is `FINANCE_UNSUBSCRIBE_SECRET` when set, otherwise derived from
 * `ENCRYPTION_KEY` with a fixed label (never the key itself, and never a
 * constant fallback).
 */

export type UnsubscribeKind = 'daily_summary' | 'weekly_digest' | 'weekly_payments';
const KINDS: readonly string[] = ['daily_summary', 'weekly_digest', 'weekly_payments'];

export interface UnsubscribeClaim {
  merchantId: string;
  kind: UnsubscribeKind;
  email: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function unsubscribeSecret(): string {
  const explicit = process.env.FINANCE_UNSUBSCRIBE_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  return createHash('sha256').update(`coinpay:finance-unsubscribe:v1:${requireEncryptionKey('unsubscribe signing')}`).digest('hex');
}

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`v1.${payload}`).digest();
}

export function signUnsubscribe(claim: UnsubscribeClaim, secret: string = unsubscribeSecret()): string {
  const payload = b64url(Buffer.from(JSON.stringify({ m: claim.merchantId, k: claim.kind, e: claim.email.trim().toLowerCase() })));
  return `${payload}.${b64url(mac(payload, secret))}`;
}

/** The claim a token carries, or null when it is malformed or its signature does not match. */
export function verifyUnsubscribe(token: unknown, secret: string = unsubscribeSecret()): UnsubscribeClaim | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = mac(payload, secret);
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { m?: unknown; k?: unknown; e?: unknown };
    if (typeof data.m !== 'string' || !data.m || typeof data.k !== 'string' || !KINDS.includes(data.k) || typeof data.e !== 'string' || !data.e) return null;
    return { merchantId: data.m, kind: data.k as UnsubscribeKind, email: data.e };
  } catch {
    return null;
  }
}
