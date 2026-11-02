/**
 * End to end over the two public routes with an in-memory Supabase:
 * options → derive + sign (as the browser does) → verify.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const db: { merchants: any[]; passphrase_credentials: any[] } = { merchants: [], passphrase_credentials: [] };

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: 'merchants' | 'passphrase_credentials') => ({
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: async () => ({ data: db[table].find((r) => r[col] === val) ?? null, error: null }),
        }),
      }),
      update: (patch: any) => ({
        eq: async (col: string, val: unknown) => {
          db[table].filter((r) => r[col] === val).forEach((r) => Object.assign(r, patch));
          return { error: null };
        },
      }),
    }),
  })),
}));

vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetAt: 0, limit: 10 })),
}));

import { POST as options } from './login-options/route';
import { POST as verify } from './login-verify/route';
import { deriveSecretKey, publicKeyHex, randomSaltHex, signLogin } from '@/lib/passphrase';
import { _resetChallenges } from '@/lib/passphrase/server';

const KDF = { alg: 'scrypt', N: 32768, r: 8, p: 1, v: 1 };
const PHRASE = 'grumpy golden otter tickles a soggy waffle beneath the frosty lighthouse merrily';

const req = (url: string, body: unknown) =>
  new NextRequest(`https://coinpayportal.com${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function browserLogin(email: string, phrase: string) {
  const o = await (await options(req('/api/auth/passphrase/login-options', { email }))).json();
  const sk = await deriveSecretKey(phrase, o.salt, o.kdf);
  const signature = await signLogin(sk, o.challenge, email);
  return { o, signature, res: await verify(req('/api/auth/passphrase/login-verify', { challengeKey: o.challengeKey, signature })) };
}

describe('passphrase login flow', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-0123456789';
    _resetChallenges();
    const salt = randomSaltHex();
    db.merchants = [{ id: 'm1', email: 'owner@example.com', name: 'Owner', is_admin: false }];
    db.passphrase_credentials = [
      { id: 'c1', merchant_id: 'm1', salt, kdf: KDF, public_key: await publicKeyHex(await deriveSecretKey(PHRASE, salt, KDF)) },
    ];
  });

  it('signs in with the right phrase, typed loosely, and sets the session cookie', async () => {
    const { res } = await browserLogin('Owner@Example.com', 'Grumpy golden otter tickles soggy waffle beneath frosty lighthouse, merrily.');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.merchant.id).toBe('m1');
    expect(res.cookies.get('token')?.value).toBe(body.token);
    expect(db.passphrase_credentials[0].last_used_at).toBeTruthy();
  }, 30000);

  it('refuses a wrong phrase', async () => {
    const { res } = await browserLogin('owner@example.com', 'grumpy golden otter tickles soggy waffle beneath frosty lighthouse sadly');
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Wrong email or passphrase');
  }, 30000);

  it('a challenge works once', async () => {
    const { o, signature, res } = await browserLogin('owner@example.com', PHRASE);
    expect(res.status).toBe(200);
    const replay = await verify(req('/api/auth/passphrase/login-verify', { challengeKey: o.challengeKey, signature }));
    expect(replay.status).toBe(400);
  }, 30000);

  it('an unknown email looks like a real one (stable decoy salt) and fails the same way', async () => {
    const a = await (await options(req('/api/auth/passphrase/login-options', { email: 'nobody@example.com' }))).json();
    const b = await (await options(req('/api/auth/passphrase/login-options', { email: 'NOBODY@example.com' }))).json();
    const real = await (await options(req('/api/auth/passphrase/login-options', { email: 'owner@example.com' }))).json();
    expect(a.salt).toBe(b.salt);
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.keys(a).sort()).toEqual(Object.keys(real).sort());
    expect(a.salt).not.toBe(real.salt);

    const { res } = await browserLogin('nobody@example.com', PHRASE);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Wrong email or passphrase');
  }, 30000);

  it('a signature for one account cannot be used for another', async () => {
    db.merchants.push({ id: 'm2', email: 'victim@example.com', name: 'V', is_admin: true });
    const o = await (await options(req('/api/auth/passphrase/login-options', { email: 'victim@example.com' }))).json();
    // Attacker signs the victim's challenge with their own (owner's) key.
    const sk = await deriveSecretKey(PHRASE, db.passphrase_credentials[0].salt, KDF);
    const signature = await signLogin(sk, o.challenge, 'victim@example.com');
    const res = await verify(req('/api/auth/passphrase/login-verify', { challengeKey: o.challengeKey, signature }));
    expect(res.status).toBe(401);
  }, 30000);
});
