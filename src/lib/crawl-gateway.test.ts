import { afterEach, describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { gate, signedIn } from './crawl-gateway';

/**
 * The lockout reported 2026-10-28: an agent on an old or headless Chrome string
 * was answered 402 on /login, /oauth and /api, so a lapsed OAuth token could
 * never be renewed. Sign-in, the app and credentialed callers are never sold;
 * a content page still is.
 */
const STALE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36';

const get = (path: string, ua: string, headers: Record<string, string> = {}) =>
  new Request(`https://coinpayportal.com${path}`, { headers: { 'user-agent': ua, accept: 'text/html', ...headers } });

const SECRET = 'session-secret-for-tests';

afterEach(() => vi.unstubAllEnvs());

describe('crawl gateway', () => {
  const app = [
    '/login',
    '/signup',
    '/oauth/authorize?client_id=cp_x&response_type=code',
    '/api/oauth/authorize',
    '/api/oauth/token',
    '/api/health',
    '/api/payments/create',
    '/dashboard',
    '/pay/abc',
    '/checkout/cs_1',
    '/invoices/inv_1/pay',
    '/web-wallet',
    '/api/webhooks/coinpay',
  ];

  for (const ua of [STALE, HEADLESS]) {
    it(`never charges sign-in or the app (${ua.match(/\w*Chrome\/\d+/)?.[0]})`, async () => {
      for (const path of app) expect(await gate(get(path, ua) as never), path).toBeFalsy();
    });

    it(`still charges a content page (${ua.match(/\w*Chrome\/\d+/)?.[0]})`, async () => {
      const res = await gate(get('/blog', ua) as never);
      expect(res?.status).toBe(402);
    });
  }

  it('never charges a caller holding a valid session', async () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    const headers = { cookie: `theme=dark; token=${jwt.sign({ userId: 'u1' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })}` };
    expect(await signedIn(get('/blog', STALE, headers))).toBe(true);
    expect(await gate(get('/blog', STALE, headers) as never)).toBeFalsy();
  });

  it('charges a forged, expired or lookalike session, and a bare bearer token on a content page', async () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    for (const headers of [
      { cookie: `token=${jwt.sign({ userId: 'u1' }, 'not-the-secret', { algorithm: 'HS256' })}` },
      { cookie: `token=${jwt.sign({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, { algorithm: 'HS256' })}` },
      { cookie: 'token=eyJhbGciOi' },
      { cookie: 'csrf_token=abc' },
      { authorization: 'Bearer cpat_abc' },
      { 'x-api-key': 'cp_live_abc' },
    ]) {
      expect(await signedIn(get('/blog', STALE, headers))).toBe(false);
      expect((await gate(get('/blog', STALE, headers) as never))?.status).toBe(402);
    }
  });

  it('honours no session at all without a secret to check it against', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const headers = { cookie: `token=${jwt.sign({ userId: 'u1' }, SECRET, { algorithm: 'HS256' })}` };
    expect(await signedIn(get('/blog', STALE, headers))).toBe(false);
  });
});
