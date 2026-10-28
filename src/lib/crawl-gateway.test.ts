import { describe, it, expect } from 'vitest';
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

  it('never charges a caller holding a session, API key or bearer token', async () => {
    for (const headers of [
      { cookie: 'theme=dark; token=eyJhbGciOi' },
      { 'x-api-key': 'cp_live_abc' },
      { authorization: 'Bearer cpat_abc' },
    ]) {
      expect(signedIn(get('/blog', STALE, headers))).toBe(true);
      expect(await gate(get('/blog', STALE, headers) as never)).toBeFalsy();
    }
  });

  it('does not mistake a lookalike cookie or an empty header for a session', () => {
    expect(signedIn(get('/blog', STALE, { cookie: 'csrf_token=abc' }))).toBe(false);
    expect(signedIn(get('/blog', STALE, { authorization: 'Bearer ' }))).toBe(false);
  });
});
