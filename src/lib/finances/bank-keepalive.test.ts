/**
 * Persistent bank browsers and keep-alive, against a fake bank in a real
 * headless Chromium: a session survives a browser restart from its profile on
 * disk, one bank's browser is used by one job at a time, Forget deletes the
 * profile, and a refresh tells "still signed in" from "needs sign-in".
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('./audit', () => ({ auditFinance: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));

import { findChrome } from '@profullstack/coinpay/statements';
import { keepAliveIntervalMs, nextTouchAt } from './bank-sessions';
import { refreshSession } from './bank-keepalive';
import { acquireBankBrowser, bankProfileDir, closeAllBankBrowsers, closeBankBrowser } from './bank-browsers';

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
const MERCHANT = '00000000-0000-4000-8000-000000000001';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!chrome)('persistent bank browsers against a fake bank', () => {
  let bank: Server;
  let origin = '';
  let rotations = 0;
  const files = mkdtempSync(path.join(tmpdir(), 'coinpay-bank-profiles-'));

  beforeAll(async () => {
    if (!process.env.CHROME_PATH) process.env.CHROME_PATH = chrome!;
    process.env.FINANCES_FILES_DIR = files;
    bank = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const cookie = req.headers.cookie ?? '';
      if (url.pathname === '/login') {
        // A session cookie: no Max-Age, so a plain browser restart would drop it.
        res.writeHead(302, { 'Set-Cookie': 'sess=live; Path=/; HttpOnly', Location: '/statements' }).end();
      } else if (url.pathname === '/statements' && /(^|;\s*)sess=live/.test(cookie)) {
        rotations += 1;
        res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': `rot=${rotations}; Path=/; Max-Age=3600` }).end('<h1>Statements</h1>');
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
  afterAll(async () => {
    await closeAllBankBrowsers();
    bank?.close();
    rmSync(files, { recursive: true, force: true });
  });

  // The fake bank is on loopback, which the real fence refuses by design.
  const check = async (url: string) => (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('about:') ? ({ ok: true } as const) : ({ ok: false, reason: 'test' } as const));

  it('keeps a signed-in session across a browser restart, from the profile on disk', { timeout: 90_000 }, async () => {
    let held = await acquireBankBrowser(MERCHANT, 'fakebank', { check });
    try {
      expect(held.bb.fresh).toBe(true);
      await held.bb.browser.cdp.send('Page.navigate', { url: `${origin}/login` }, held.bb.page);
      await sleep(1500);
      const alive = await refreshSession(held.bb.browser, held.bb.page, { startUrl: `${origin}/statements`, watchMs: 3000 });
      expect(alive.signedIn).toBe(true);
      if (alive.signedIn) expect(alive.state.cookies.find((c) => c.name === 'rot')?.value).toBe(String(rotations));
    } finally {
      held.release();
    }

    // A deploy: the browser goes away; the profile on the volume stays.
    await closeBankBrowser(MERCHANT, 'fakebank');
    expect(existsSync(bankProfileDir(MERCHANT, 'fakebank'))).toBe(true);

    held = await acquireBankBrowser(MERCHANT, 'fakebank', { check }); // no sealed restore on purpose
    try {
      expect(held.bb.fresh).toBe(true);
      const after = await refreshSession(held.bb.browser, held.bb.page, { startUrl: `${origin}/statements`, watchMs: 3000 });
      expect(after.signedIn).toBe(true);
    } finally {
      held.release();
    }
  });

  it('comes back from a restart with one tab, not every tab the last run had open', { timeout: 90_000 }, async () => {
    let held = await acquireBankBrowser(MERCHANT, 'tabsbank', { check });
    try {
      for (let i = 0; i < 3; i += 1) await held.bb.browser.cdp.send('Target.createTarget', { url: `${origin}/other-${i}` });
      await held.bb.browser.cdp.send('Page.navigate', { url: `${origin}/login` }, held.bb.page);
      await sleep(1500);
    } finally {
      held.release();
    }
    await closeBankBrowser(MERCHANT, 'tabsbank');
    held = await acquireBankBrowser(MERCHANT, 'tabsbank', { check });
    try {
      await sleep(1000);
      const { targetInfos } = (await held.bb.browser.cdp.send('Target.getTargets')) as { targetInfos: { type: string; url: string }[] };
      expect(targetInfos.filter((t) => t.type === 'page' && !t.url.startsWith('chrome')).length).toBe(1);
    } finally {
      held.release();
      await closeBankBrowser(MERCHANT, 'tabsbank', { deleteProfile: true });
    }
  });

  it('lets one job at a time use a bank browser', { timeout: 60_000 }, async () => {
    const first = await acquireBankBrowser(MERCHANT, 'fakebank', { check });
    let secondIn = false;
    const second = acquireBankBrowser(MERCHANT, 'fakebank', { check }).then((h) => {
      secondIn = true;
      return h;
    });
    await sleep(300);
    expect(secondIn).toBe(false);
    first.release();
    const h = await second;
    expect(secondIn).toBe(true);
    expect(h.bb.fresh).toBe(false);
    h.release();
  });

  it('tells needs sign-in from a password page and from a bounce to the logon page', { timeout: 60_000 }, async () => {
    const held = await acquireBankBrowser(MERCHANT, 'otherbank', { check });
    try {
      const page = await refreshSession(held.bb.browser, held.bb.page, { startUrl: `${origin}/statements`, watchMs: 4000 });
      expect(page.signedIn).toBe(false);
      await held.bb.browser.cdp.send('Storage.setCookies', { cookies: [{ name: 'bounce', value: '1', domain: '127.0.0.1', path: '/' }] });
      const bounced = await refreshSession(held.bb.browser, held.bb.page, { startUrl: `${origin}/statements`, watchMs: 5000 });
      expect(bounced).toMatchObject({ signedIn: false });
      expect(bounced.url).toContain('/web/auth/logon');
    } finally {
      held.release();
    }
  });

  it('forgets a bank: browser closed and profile deleted', { timeout: 30_000 }, async () => {
    await closeBankBrowser(MERCHANT, 'otherbank', { deleteProfile: true });
    expect(existsSync(bankProfileDir(MERCHANT, 'otherbank'))).toBe(false);
    expect(() => bankProfileDir('not-a-uuid', 'x')).toThrow();
    expect(() => bankProfileDir(MERCHANT, '../etc')).toThrow();
  });
});
