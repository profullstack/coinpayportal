/**
 * The cloud bank browser against a real headless Chromium: the request fence,
 * session capture and restore, and a live sign-in session driven by input
 * events. Skipped where no Chromium is installed.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
const FILES = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'coinpay-live-files-'));
vi.mock('./files', () => ({ putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn(), filesDir: () => FILES }));
vi.mock('./audit', () => ({ auditFinance: vi.fn() }));

import { findChrome } from '@profullstack/coinpay/statements';
import { cloudBrowserStats, finishLiveSession, launchCloudBrowser, liveStatus, parseLiveInput, sendLiveInput, startLiveSession, subscribeLive, LiveSessionError } from './cloud-browser';
import { installRequestGuard } from './bank-guard';
import { bankBrowserStats } from './bank-browsers';
import { captureState, restoreState, RESTORE_STORAGE } from './bank-sessions';

describe('parseLiveInput', () => {
  it('clamps coordinates to the viewport and refuses what it does not know', () => {
    expect(parseLiveInput({ type: 'click', x: 99999, y: -5 })).toEqual({ type: 'click', x: 1280, y: 0, button: 'left', clickCount: 1 });
    expect(parseLiveInput({ type: 'key', key: 'Enter' })).toMatchObject({ type: 'key', key: 'Enter' });
    expect(() => parseLiveInput({ type: 'key', key: 'F13' })).toThrow(LiveSessionError);
    expect(() => parseLiveInput({ type: 'text', text: '' })).toThrow(LiveSessionError);
    expect(() => parseLiveInput({ type: 'text', text: 'x'.repeat(2001) })).toThrow(LiveSessionError);
    expect(() => parseLiveInput({ type: 'exec', code: 'rm -rf /' })).toThrow(LiveSessionError);
  });
});

const chrome = process.env.CHROME_PATH || findChrome();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!chrome)('cloud browser with real Chromium', () => {
  let server: Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    if (!process.env.CHROME_PATH) process.env.CHROME_PATH = chrome!;
    server = createServer((_req, res) => {
      hits += 1;
      res.end('internal');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server?.close());

  it('never lets a page reach an internal address', { timeout: 60_000 }, async () => {
    const { browser, release } = await launchCloudBrowser();
    const blocked: string[] = [];
    try {
      let page: string | null = null;
      const stop = await installRequestGuard(browser.cdp, {
        onBlocked: (url) => blocked.push(url),
        onTarget: (t) => {
          if (t.type === 'page') page = t.sessionId;
        },
      });
      for (let i = 0; i < 50 && !page; i += 1) await sleep(100);
      const html = `<img src="http://127.0.0.1:${port}/img"><script>fetch('http://127.0.0.1:${port}/fetch').catch(()=>{}); setTimeout(()=>location.href='http://127.0.0.1:${port}/nav',300)</script>`;
      await browser.cdp.send('Page.navigate', { url: `data:text/html,${encodeURIComponent(html)}` }, page!);
      await sleep(2500);
      stop();
      expect(hits).toBe(0);
      expect(blocked.some((u) => u.includes(`127.0.0.1:${port}`))).toBe(true);
    } finally {
      await release();
    }
    expect(cloudBrowserStats().running).toBe(0);
  });

  it('downloads statements through the fence with a restored session', { timeout: 90_000 }, async () => {
    const PDF = (m: string) => Buffer.from(`%PDF-1.4\n% ${m}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`, 'latin1');
    const bank = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const signedIn = /(^|;\s*)s=1/.test(req.headers.cookie ?? '');
      if (url.pathname === '/statements' && !signedIn) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<input type=password>');
      } else if (url.pathname === '/statements') {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<table>
          <tr><td>Account ending 6496</td><td>Statement 07/16/2026 - 08/15/2026</td><td><a href="/pdf/aug">Download</a></td></tr>
          <tr><td>Account ending 6496</td><td>June 2026</td><td><a href="/inline/jun">PDF</a></td></tr></table>`);
      } else if (url.pathname === '/pdf/aug') {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="aug.pdf"' }).end(PDF('aug'));
      } else if (url.pathname === '/inline/jun') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' }).end(PDF('jun'));
      } else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => bank.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(bank.address() as { port: number }).port}`;
    const sf = await import('@profullstack/coinpay/statements');
    const { browser, release } = await launchCloudBrowser();
    try {
      let page: string | null = null;
      const stop = await installRequestGuard(browser.cdp, {
        // The fake bank is on loopback, which the real check refuses by design.
        check: async (url) => (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('about:') ? { ok: true } : { ok: false, reason: 'test' }),
        onTarget: (t) => {
          if (t.type === 'page' && !t.url.startsWith('chrome') && !page) page = t.sessionId;
        },
      });
      for (let i = 0; i < 50 && !page; i += 1) await sleep(100);
      await restoreState(browser.cdp, page!, { version: 1, savedAt: '', userAgent: null, cookies: [{ name: 's', value: '1', domain: '127.0.0.1', path: '/' }], storage: {} });
      const files: { name: string; context: string }[] = [];
      const result = await sf.fetchInstitution(browser, {
        start: `${origin}/statements`,
        renderMs: 4000,
        onFile: (d) => {
          expect(sf.isPdf(d.bytes)).toBe(true);
          files.push({ name: d.suggestedName, context: d.context });
        },
      });
      expect(result).toMatchObject({ status: 'ok', candidates: 2 });
      expect(files.map((f) => sf.periodOf(f.context)?.month).sort()).toEqual(['2026-06', '2026-08']);

      // Site storage goes back as call arguments: hostile-looking values stay data.
      await browser.cdp.send('Page.navigate', { url: `${origin}/statements` }, page!);
      await sleep(800);
      const { result: global } = (await browser.cdp.send('Runtime.evaluate', { expression: 'globalThis' }, page!)) as { result: { objectId: string } };
      const call = (o: string, items: unknown) =>
        browser.cdp.send('Runtime.callFunctionOn', { objectId: global.objectId, functionDeclaration: RESTORE_STORAGE, arguments: [{ value: o }, { value: items }], returnByValue: true }, page!);
      const evil = `"]);document.title='pwned';//`;
      await call(origin, [['deviceId', 'd-1'], [evil, `</script><script>alert(1)</script>`], [1, 'not a pair'], 'junk']);
      const { result: read } = (await browser.cdp.send('Runtime.evaluate', { expression: `JSON.stringify([localStorage.getItem('deviceId'), localStorage.getItem(${JSON.stringify(evil)}), document.title, localStorage.length])`, returnByValue: true }, page!)) as { result: { value: string } };
      expect(JSON.parse(read.value)).toEqual(['d-1', '</script><script>alert(1)</script>', '', 2]);
      const { result: refused } = (await call('https://other.example', [['x', 'y']])) as { result: { value: boolean } };
      expect(refused.value).toBe(false);
      stop();
    } finally {
      await release();
      bank.close();
    }
  });

  it('carries a session from one browser to the next', { timeout: 60_000 }, async () => {
    const first = await launchCloudBrowser();
    let state;
    try {
      await first.browser.cdp.send('Storage.setCookies', {
        cookies: [{ name: 'sid', value: 'bank-session', domain: '.bank.example', path: '/', secure: true, httpOnly: true, expires: Math.floor(Date.now() / 1000) + 3600 }],
      });
      state = await captureState(first.browser.cdp, null);
    } finally {
      await first.release();
    }
    expect(state.cookies.find((c) => c.name === 'sid')).toMatchObject({ value: 'bank-session', httpOnly: true });

    const second = await launchCloudBrowser();
    try {
      const { targetInfos } = (await second.browser.cdp.send('Target.getTargets')) as { targetInfos: { targetId: string; type: string }[] };
      const { sessionId } = (await second.browser.cdp.send('Target.attachToTarget', { targetId: targetInfos.find((t) => t.type === 'page')!.targetId, flatten: true })) as { sessionId: string };
      await restoreState(second.browser.cdp, sessionId, { ...state, storage: {} });
      const { cookies } = (await second.browser.cdp.send('Storage.getCookies')) as { cookies: { name: string; value: string }[] };
      expect(cookies.find((c) => c.name === 'sid')?.value).toBe('bank-session');
    } finally {
      await second.release();
    }
  });

  it('streams a live session and replays clicks and typing', { timeout: 60_000 }, async () => {
    const html = '<title>empty</title><input id="user" oninput="document.title = this.value" style="position:absolute;left:20px;top:20px;width:300px;height:40px">';
    const M = '00000000-0000-4000-8000-0000000000aa';
    const { id } = await startLiveSession({ merchantId: M, actorId: M, institutionKey: 'testbank', institutionLabel: 'Test Bank', url: `data:text/html,${encodeURIComponent(html)}` });
    const frames: string[] = [];
    const statuses: string[] = [];
    const unsubscribe = subscribeLive(id, M, (f) => frames.push(f.data), (s) => statuses.push(s));
    try {
      expect(() => liveStatus(id, 'someone-else')).toThrow(LiveSessionError);
      for (let i = 0; i < 50 && frames.length === 0; i += 1) await sleep(100);
      expect(frames.length).toBeGreaterThan(0);
      expect(Buffer.from(frames[0]!, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8'); // JPEG

      await sendLiveInput(id, M, { type: 'click', x: 100, y: 40 });
      await sendLiveInput(id, M, { type: 'text', text: 'anthony' });
      await sendLiveInput(id, M, { type: 'key', key: 'Backspace' });
      for (let i = 0; i < 30 && liveStatus(id, M).title !== 'anthon'; i += 1) await sleep(100);
      expect(liveStatus(id, M).title).toBe('anthon');
      // A data: page sets no cookies, so there is nothing to keep yet.
      await expect(finishLiveSession(id, { id: M, actorId: M }, true)).rejects.toThrow(/no cookies/);
      expect(liveStatus(id, M).status).toBe('live');
      await finishLiveSession(id, { id: M, actorId: M }, false);
      expect(liveStatus(id, M).status).toBe('cancelled');
      expect(statuses).toContain('cancelled');
    } finally {
      unsubscribe();
    }
    // A bank signs in on its persistent browser; a cancelled, never-saved sign-in closes it.
    for (let i = 0; i < 50 && bankBrowserStats().running > 0; i += 1) await sleep(100);
    expect(bankBrowserStats().running).toBe(0);
    expect(cloudBrowserStats().running).toBe(0);
  });
});
