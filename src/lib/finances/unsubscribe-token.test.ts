import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { signUnsubscribe, verifyUnsubscribe, unsubscribeSecret } from './unsubscribe-token';

// Generated per run: no key material in the repo.
const SECRET = randomBytes(32).toString('hex');
const claim = { merchantId: 'merchant-aaa', kind: 'daily_summary' as const, email: 'Alice@Example.com' };

describe('unsubscribe tokens', () => {
  it('round-trips, with the address lower-cased', () => {
    const token = signUnsubscribe(claim, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyUnsubscribe(token, SECRET)).toEqual({ ...claim, email: 'alice@example.com' });
  });

  it('cannot be re-pointed at another merchant or address', () => {
    const token = signUnsubscribe(claim, SECRET);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ m: 'merchant-bbb', k: 'daily_summary', e: 'alice@example.com' })).toString('base64url');
    expect(verifyUnsubscribe(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyUnsubscribe(token, randomBytes(32).toString('hex'))).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const bad of [null, '', 'abc', 'a.b.c', `${'a'.repeat(3000)}.b`, '.']) expect(verifyUnsubscribe(bad, SECRET)).toBeNull();
  });

  it('derives its key from ENCRYPTION_KEY when no dedicated secret is set, never the key itself', () => {
    const before = { e: process.env.ENCRYPTION_KEY, s: process.env.FINANCE_UNSUBSCRIBE_SECRET };
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    delete process.env.FINANCE_UNSUBSCRIBE_SECRET;
    try {
      const derived = unsubscribeSecret();
      expect(derived).toMatch(/^[0-9a-f]{64}$/);
      expect(derived).not.toBe(process.env.ENCRYPTION_KEY);
      expect(verifyUnsubscribe(signUnsubscribe(claim))).not.toBeNull();
      delete process.env.ENCRYPTION_KEY;
      expect(() => unsubscribeSecret()).toThrow(/ENCRYPTION_KEY/);
    } finally {
      if (before.e === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = before.e;
      if (before.s !== undefined) process.env.FINANCE_UNSUBSCRIBE_SECRET = before.s;
    }
  });
});

describe('weekly digest unsubscribe link', () => {
  it('round-trips and cannot be turned into a daily summary token', () => {
    const weekly = { merchantId: 'merchant-aaa', kind: 'weekly_digest' as const, email: 'alice@example.com' };
    const token = signUnsubscribe(weekly, SECRET);
    expect(verifyUnsubscribe(token, SECRET)).toEqual(weekly);
    const [, sig] = token.split('.');
    const swapped = Buffer.from(JSON.stringify({ m: 'merchant-aaa', k: 'daily_summary', e: 'alice@example.com' })).toString('base64url');
    expect(verifyUnsubscribe(`${swapped}.${sig}`, SECRET)).toBeNull();
    const unknownKind = Buffer.from(JSON.stringify({ m: 'merchant-aaa', k: 'everything', e: 'alice@example.com' })).toString('base64url');
    expect(verifyUnsubscribe(`${unknownKind}.${sig}`, SECRET)).toBeNull();
  });
});
