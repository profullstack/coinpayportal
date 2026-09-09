import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, presentedCredential } from './proxy';

/**
 * The limiter's store is module-level with no reset hook, so every test uses a
 * distinct IP. That is closer to reality anyway — buckets are per client.
 */
function post(
  path: string,
  ip: string,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(`https://coinpayportal.com${path}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, ...headers },
  });
}

/** How many requests land before the limiter starts answering 429. */
async function countUntilLimited(
  path: string,
  ip: string,
  attempts: number,
  headers: Record<string, string> = {}
): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < attempts; i++) {
    const response = await proxy(post(path, ip, headers));
    if (response.status === 429) break;
    allowed++;
  }
  return allowed;
}

describe('presentedCredential', () => {
  const headersOf = (init: Record<string, string>) => new Headers(init);

  it('reads a bearer token', () => {
    expect(presentedCredential(headersOf({ authorization: 'Bearer sk_live_abc' }))).toBe(
      'sk_live_abc'
    );
  });

  it('is case-insensitive about the scheme', () => {
    expect(presentedCredential(headersOf({ authorization: 'bearer sk_live_abc' }))).toBe(
      'sk_live_abc'
    );
  });

  it('reads x-api-key', () => {
    expect(presentedCredential(headersOf({ 'x-api-key': 'sk_live_xyz' }))).toBe('sk_live_xyz');
  });

  it('reads the wallet extension\'s Wallet scheme, not just Bearer', () => {
    // packages/extension/src/core/api.ts signs with this exact shape.
    expect(
      presentedCredential(headersOf({ authorization: 'Wallet wid-1:sig-abc:1234567890' }))
    ).toBe('wid-1:sig-abc:1234567890');
  });

  it('distinguishes two wallets using the same scheme', () => {
    const a = presentedCredential(headersOf({ authorization: 'Wallet wid-1:sig:1' }));
    const b = presentedCredential(headersOf({ authorization: 'Wallet wid-2:sig:1' }));
    expect(a).not.toBe(b);
  });

  it('is null when no credential is presented', () => {
    expect(presentedCredential(headersOf({}))).toBeNull();
  });

  it('ignores a bearer header with no token', () => {
    expect(presentedCredential(headersOf({ authorization: 'Bearer' }))).toBeNull();
  });
});

describe('proxy rate limiting', () => {
  // 100/min is the house default in @profullstack/throttle, and it now applies
  // to every route rather than just /api/ -- which is the whole point of the
  // change: the scraper that prompted it never touched an API path.
  it('caps an anonymous API caller at the general limit', async () => {
    const allowed = await countUntilLimited('/api/rates', '10.1.0.1', 140);
    expect(allowed).toBe(100);
  });

  it('meters a page route too, not only /api/', async () => {
    const allowed = await countUntilLimited('/explorer/eth/tx/0xabc', '10.1.0.9', 140);
    expect(allowed).toBe(100);
  });

  // The regression that broke bulk invoice payments: ugig.net mints one payment
  // request per accepted invoice from a single server IP, so an 80-invoice queue
  // burst past 60/min and the rest came back "Too many requests" during prepare.
  it('lets a credentialed integration burst well past the anonymous limit', async () => {
    const allowed = await countUntilLimited('/api/payments/create', '10.1.0.2', 200, {
      authorization: 'Bearer sk_live_ugig',
    });
    expect(allowed).toBe(200);
  });

  // The extension uses the `Wallet` scheme; a batch spends two API calls per
  // payment, so treating it as anonymous capped a payout at ~30 payments.
  it('gives the wallet extension the credentialed budget', async () => {
    const allowed = await countUntilLimited('/api/web-wallet/w1/broadcast', '10.1.0.6', 200, {
      authorization: 'Wallet wid-1:sig-abc:1234567890',
    });
    expect(allowed).toBe(200);
  });

  it('budgets each API key separately from the same host', async () => {
    const headersA = { authorization: 'Bearer sk_live_a' };
    const headersB = { authorization: 'Bearer sk_live_b' };
    // Spend key A's whole budget.
    expect(await countUntilLimited('/api/payments/create', '10.1.0.3', 700, headersA)).toBe(600);
    // Key B is untouched.
    const response = await proxy(post('/api/payments/create', '10.1.0.3', headersB));
    expect(response.status).toBe(200);
  });

  it('still bounds a host that rotates keys', async () => {
    const ip = '10.1.0.4';
    let limited = false;
    let allowed = 0;
    for (let i = 0; i < 1400 && !limited; i++) {
      const response = await proxy(
        post('/api/payments/create', ip, { authorization: `Bearer sk_rotate_${i}` })
      );
      if (response.status === 429) limited = true;
      else allowed++;
    }
    expect(limited).toBe(true);
    expect(allowed).toBe(1200);
  });

  // Without this, brute-forcing a login is a matter of bolting on an unverified
  // Authorization header to buy a 600/min budget.
  it('keeps auth endpoints IP-limited even when a credential is presented', async () => {
    const allowed = await countUntilLimited('/api/auth/login', '10.1.0.5', 40, {
      authorization: 'Bearer sk_live_anything',
    });
    expect(allowed).toBe(10);
  });
});
