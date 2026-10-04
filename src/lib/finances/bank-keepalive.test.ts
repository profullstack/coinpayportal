/**
 * Keep-alive: the touch decides "still signed in" or "needs sign-in" against a
 * fake bank in a real headless Chromium, and saves the cookies the bank rotates.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('./files', () => ({ putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn() }));
vi.mock('./audit', () => ({ auditFinance: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));

import { findChrome } from '@profullstack/coinpay/statements';
import { keepAliveIntervalMs, nextTouchAt, type SessionState } from './bank-sessions';
import { touchSession } from './bank-keepalive';
import { launchCloudBrowser } from './cloud-browser';

describe('keep-alive cadence', () => {
  it('defaults to 10 minutes, never under 3, with 20% jitter either way', () => {
    expect(keepAliveIntervalMs({})).toBe(600_000);
    expect(keepAliveIntervalMs({ FINANCES_BANK_KEEPALIVE_MINUTES: '1' })).toBe(180_000);
    const now = 1_000_000;
    expect(Date.parse(nextTouchAt(now, () => 0, {})) - now).toBe(480_000);
    expect(Date.parse(nextTouchAt(now, () => 1, {})) - now).toBe(720_000);
  });
});

const chrome = process.env.CHROME_PATH || findChrome();

describe.skipIf(!chrome)('touchSession against a fake bank', () => {
  let bank: Server;
  let origin = '';
  let visits = 0;

  beforeAll(async () => {
    if (!process.env.CHROME_PATH) process.env.CHROME_PATH = chrome!;
    bank = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const cookie = req.headers.cookie ?? '';
      const signedIn = /(^|;\s*)s=1/.test(cookie);
      if (url.pathname === '/statements' && signedIn) {
        visits += 1;
        // A bank rotating its session token on every visit.
        res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': `rot=${visits}; Path=/; Max-Age=3600` }).end('<h1>Statements</h1>');
      } else if (url.pathname === '/statements' && /bounce=1/.test(cookie)) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script>location.href="/web/auth/logon"</script>');
      } else if (url.pathname === '/statements') {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<form><input name=u><input type=password></form>');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>Please sign in</p>');
      }
    });
    await new Promise<void>((resolve) => bank.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(bank.address() as { port: number }).port}`;
  });
  afterAll(() => bank?.close());

  // The fake bank is on loopback, which the real fence refuses by design.
  const check = async (url: string) => (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('about:') ? ({ ok: true } as const) : ({ ok: false, reason: 'test' } as const));
  const stateWith = (cookies: SessionState['cookies']): SessionState => ({ version: 1, savedAt: '', userAgent: null, cookies, storage: {} });

  it('keeps a live session and captures the cookie the bank rotated', { timeout: 60_000 }, async () => {
    const { browser, release } = await launchCloudBrowser();
    try {
      const result = await touchSession(browser, { state: stateWith([{ name: 's', value: '1', domain: '127.0.0.1', path: '/' }]), startUrl: `${origin}/statements`, watchMs: 3000, check });
      expect(result.signedIn).toBe(true);
      if (result.signedIn) {
        expect(result.state.cookies.find((c) => c.name === 's')?.value).toBe('1');
        expect(result.state.cookies.find((c) => c.name === 'rot')?.value).toBe(String(visits));
      }
    } finally {
      await release();
    }
  });

  it('says needs sign-in when the bank shows a password field', { timeout: 60_000 }, async () => {
    const { browser, release } = await launchCloudBrowser();
    try {
      const result = await touchSession(browser, { state: stateWith([]), startUrl: `${origin}/statements`, watchMs: 4000, check });
      expect(result.signedIn).toBe(false);
    } finally {
      await release();
    }
  });

  it('says needs sign-in when the bank bounces to its logon page', { timeout: 60_000 }, async () => {
    const { browser, release } = await launchCloudBrowser();
    try {
      const result = await touchSession(browser, { state: stateWith([{ name: 'bounce', value: '1', domain: '127.0.0.1', path: '/' }]), startUrl: `${origin}/statements`, watchMs: 5000, check });
      expect(result).toMatchObject({ signedIn: false });
      expect(result.url).toContain('/web/auth/logon');
    } finally {
      await release();
    }
  });
});
