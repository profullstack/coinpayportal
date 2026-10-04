import 'server-only';
import { randomBytes } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { checkUrl, installRequestGuard } from './bank-guard';
import { captureState, saveSession, type SessionState } from './bank-sessions';

/**
 * Chrome on CoinPay's own server, for bank sign-ins and statement fetches.
 *
 * Every browser here is headless and fenced (bank-guard.ts) before its first
 * request. A *live* session is one a merchant drives from the PWA: CoinPay
 * streams JPEG frames of the page (Page.startScreencast) and replays their
 * clicks and keystrokes (Input.*), so the bank sees CoinPay's server as the
 * device it trusts. When they press Save, the session (cookies and site
 * storage) is captured and sealed; fetches restore it later.
 *
 * Live sessions live in this process's memory: coinpayportal runs as one
 * container, and a restart ending a half-finished sign-in is acceptable.
 */

type Engine = typeof import('@profullstack/coinpay/statements');
type Browser = Awaited<ReturnType<Engine['openBrowser']>>;

let engine: Promise<Engine> | null = null;
export function loadEngine(): Promise<Engine> {
  engine ??= import('@profullstack/coinpay/statements');
  return engine;
}

// ---------------------------------------------------------------------------
// One budget of Chromes for the whole server
// ---------------------------------------------------------------------------

function maxBrowsers(): number {
  const n = Number(process.env.FINANCES_CLOUD_BROWSER_MAX ?? 2);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 8) : 2;
}

let running = 0;

export class BrowserBusyError extends Error {
  code = 'cloud_browser_busy';
  status = 429;
}

/**
 * Start a fenced headless Chrome on a throwaway profile, or throw
 * BrowserBusyError when the server is already running its share.
 */
export async function launchCloudBrowser(): Promise<{ browser: Browser; release: () => Promise<void> }> {
  if (running >= maxBrowsers()) throw new BrowserBusyError('CoinPay is already running as many bank browsers as it allows; try again in a minute');
  running += 1;
  const profile = await mkdtemp(path.join(tmpdir(), 'coinpay-bank-'));
  let browser: Browser | null = null;
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      if (browser) await browser.close();
    } finally {
      running -= 1;
      await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    }
  };
  try {
    const sf = await loadEngine();
    const chrome = process.env.CHROME_PATH || sf.findChrome();
    if (!chrome) throw new Error('No Chromium on this server (set CHROME_PATH)');
    browser = await sf.openBrowser({
      chrome,
      profile,
      headless: true,
      handleSignals: false,
      extraArgs: ['--disable-dev-shm-usage', '--disable-gpu', '--disable-features=Translate,MediaRouter', '--lang=en-US'],
    });
    return { browser, release };
  } catch (err) {
    await release();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Live sign-in sessions
// ---------------------------------------------------------------------------

export const VIEWPORT = { width: 1280, height: 860 };
const IDLE_MS = 10 * 60_000;
const MAX_MS = 30 * 60_000;

export type LiveStatus = 'starting' | 'live' | 'saving' | 'saved' | 'cancelled' | 'expired' | 'failed';

export interface LiveFrame {
  data: string; // base64 JPEG
  url: string;
  title: string;
  at: number;
}

interface LiveSession {
  id: string;
  merchantId: string;
  actorId: string;
  institutionKey: string;
  institutionLabel: string | null;
  status: LiveStatus;
  error: string | null;
  createdAt: number;
  touchedAt: number;
  browser: Browser;
  release: () => Promise<void>;
  page: string | null; // the session id of the tab being shown
  frame: LiveFrame | null;
  url: string;
  title: string;
  listeners: Set<(frame: LiveFrame) => void>;
  statusListeners: Set<(status: LiveStatus) => void>;
  stopGuard: () => void;
  blocked: number;
  timer: NodeJS.Timeout;
  ticks: number;
  onPageText?: (text: string) => void;
  offCdp: () => void;
}

const live = new Map<string, LiveSession>();

export class LiveSessionError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function setStatus(s: LiveSession, status: LiveStatus, error: string | null = null): void {
  s.status = status;
  s.error = error;
  for (const listener of s.statusListeners) listener(status);
}

async function showPage(s: LiveSession, pageSession: string): Promise<void> {
  const { cdp } = s.browser;
  if (s.page && s.page !== pageSession) await cdp.send('Page.stopScreencast', {}, s.page).catch(() => undefined);
  s.page = pageSession;
  await cdp.send('Page.enable', {}, pageSession).catch(() => undefined);
  const { userAgent } = (await cdp.send('Browser.getVersion')) as { userAgent: string };
  await cdp.send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome'), acceptLanguage: 'en-US,en' }, pageSession).catch(() => undefined);
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false }, pageSession).catch(() => undefined);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 }, pageSession).catch(() => undefined);
}

/** Chrome reports URL changes as target events but not title changes, so read both from the page. */
async function readLocation(s: LiveSession): Promise<void> {
  if (!s.page || s.status !== 'live') return;
  try {
    const { result } = (await s.browser.cdp.send('Runtime.evaluate', { expression: 'JSON.stringify([location.href, document.title])', returnByValue: true }, s.page)) as { result: { value?: string } };
    const [href, title] = JSON.parse(result.value ?? '[]') as [string?, string?];
    if (href) s.url = href;
    if (typeof title === 'string') s.title = title;
  } catch {
    // Mid-navigation; the next tick reads it.
  }
}

/** Hand the page's visible text to the session's watcher (lockout detection for tax sources). */
async function readText(s: LiveSession): Promise<void> {
  if (!s.page || s.status !== 'live' || !s.onPageText) return;
  try {
    const { result } = (await s.browser.cdp.send('Runtime.evaluate', { expression: "document.body ? (document.body.innerText || '').slice(0, 6000) : ''", returnByValue: true }, s.page)) as { result: { value?: string } };
    if (result.value) s.onPageText(result.value);
  } catch {
    // Mid-navigation; the next tick reads it.
  }
}

function expire(s: LiveSession, status: LiveStatus, error: string | null = null): void {
  if (['saved', 'cancelled', 'expired', 'failed'].includes(s.status)) return;
  clearInterval(s.timer);
  setStatus(s, status, error);
  s.stopGuard();
  s.offCdp();
  // A bank's browser outlives the sign-in: stop streaming it, then let go.
  if (s.page) void s.browser.cdp.send('Page.stopScreencast', {}, s.page).catch(() => undefined);
  void s.release();
  // Keep the record a little while so the CLI and the PWA can read the outcome.
  setTimeout(() => live.delete(s.id), 5 * 60_000).unref?.();
}

/** Open the bank in a cloud browser for one merchant. One live session per merchant at a time. */
export async function startLiveSession(params: {
  merchantId: string;
  actorId: string;
  institutionKey: string;
  institutionLabel: string | null;
  url: string;
  /** Called every few seconds with the page's text while the merchant drives it. */
  onPageText?: (text: string) => void;
}): Promise<{ id: string; status: LiveStatus }> {
  const verdict = await checkUrl(params.url);
  if (!verdict.ok) throw new LiveSessionError('invalid_request', `That address cannot be opened: ${verdict.reason}`);
  for (const existing of live.values()) {
    if (existing.merchantId === params.merchantId && ['starting', 'live', 'saving'].includes(existing.status)) expire(existing, 'cancelled');
  }

  // A bank signs in on its own long-running browser (bank-browsers.ts), the
  // one keep-alive and fetches will use. Tax sources keep a throwaway browser
  // under their visit throttle.
  const sf = await loadEngine();
  const persistent = !sf.taxSource(params.institutionKey);
  let browser: Browser;
  let release: () => Promise<void>;
  let mainPage: string | null = null;
  let follow: ((onPage: (sessionId: string) => void) => () => void) | null = null;
  if (persistent) {
    const { acquireBankBrowser, closeBankBrowser } = await import('./bank-browsers');
    const { getBankSession, loadSessionState } = await import('./bank-sessions');
    const held = await acquireBankBrowser(params.merchantId, params.institutionKey, {
      restore: async () => {
        const row = await getBankSession(params.merchantId, params.institutionKey).catch(() => null);
        return row ? loadSessionState(row).catch(() => null) : null;
      },
    });
    browser = held.bb.browser;
    mainPage = held.bb.page;
    follow = (onPage) => held.bb.onTarget((info) => {
      if (info.type === 'page' && !info.url.startsWith('chrome')) onPage(info.sessionId);
    });
    release = async () => {
      held.release();
      // A sign-in that never saved leaves nothing worth keeping a browser for.
      const { getBankSession: get } = await import('./bank-sessions');
      const row = await get(params.merchantId, params.institutionKey).catch(() => null);
      if (!row || row.state !== 'active') await closeBankBrowser(params.merchantId, params.institutionKey);
    };
  } else {
    ({ browser, release } = await launchCloudBrowser());
  }
  const id = randomBytes(18).toString('base64url');
  const s: LiveSession = {
    id,
    merchantId: params.merchantId,
    actorId: params.actorId,
    institutionKey: params.institutionKey,
    institutionLabel: params.institutionLabel,
    status: 'starting',
    error: null,
    createdAt: Date.now(),
    touchedAt: Date.now(),
    browser,
    release,
    page: null,
    frame: null,
    url: params.url,
    title: '',
    listeners: new Set(),
    statusListeners: new Set(),
    stopGuard: () => undefined,
    blocked: 0,
    ticks: 0,
    onPageText: params.onPageText,
    offCdp: () => undefined,
    timer: setInterval(() => {
      const now = Date.now();
      s.ticks += 1;
      if (now - s.touchedAt > IDLE_MS) expire(s, 'expired', 'No activity for 10 minutes');
      else if (now - s.createdAt > MAX_MS) expire(s, 'expired', 'Sign-in sessions last 30 minutes');
      else {
        void readLocation(s);
        if (s.ticks % 3 === 0) void readText(s);
      }
    }, 1000),
  };
  s.timer.unref?.();
  live.set(id, s);

  try {
    const { cdp } = browser;
    s.offCdp = cdp.on(({ method, params: p, sessionId }) => {
      if (method === 'Page.screencastFrame' && sessionId === s.page) {
        void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sessionId).catch(() => undefined);
        const frame: LiveFrame = { data: String(p.data), url: s.url, title: s.title, at: Date.now() };
        s.frame = frame;
        for (const listener of s.listeners) listener(frame);
      } else if (method === 'Target.targetInfoChanged') {
        const info = p.targetInfo as { type?: string; url?: string; title?: string; attached?: boolean };
        if (info.type === 'page' && info.url) {
          s.url = info.url;
          s.title = info.title ?? '';
        }
      }
    });
    if (follow && mainPage) {
      // Already fenced at launch; follow the newest tab (banks open MFA and statements in popups).
      s.stopGuard = follow((sessionId) => void showPage(s, sessionId));
      await showPage(s, mainPage);
    } else {
      await cdp.send('Target.setDiscoverTargets', { discover: true });
      s.stopGuard = await installRequestGuard(cdp, {
        onBlocked: () => {
          s.blocked += 1;
        },
        // Follow the newest tab: banks open statements and MFA in popups.
        onTarget: (info) => {
          // Chrome's own UI (chrome://omnibox-popup…) also shows up as a page.
          if (info.type === 'page' && !info.url.startsWith('chrome')) void showPage(s, info.sessionId);
        },
      });
    }
    for (let i = 0; i < 50 && !s.page; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (!s.page) throw new Error('The cloud browser opened no tab');
    await cdp.send('Page.navigate', { url: params.url }, s.page);
    setStatus(s, 'live');
    browser.exited.then(() => expire(s, 'failed', 'The cloud browser stopped'));
    return { id, status: s.status };
  } catch (err) {
    expire(s, 'failed', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

function owned(id: string, merchantId: string): LiveSession {
  const s = live.get(id);
  if (!s || s.merchantId !== merchantId) throw new LiveSessionError('not_found', 'No such sign-in session', 404);
  return s;
}

export function liveStatus(id: string, merchantId: string) {
  const s = owned(id, merchantId);
  return {
    id: s.id,
    status: s.status,
    error: s.error,
    institutionKey: s.institutionKey,
    institutionLabel: s.institutionLabel,
    url: s.url,
    title: s.title,
    viewport: VIEWPORT,
    blockedRequests: s.blocked,
    startedAt: new Date(s.createdAt).toISOString(),
  };
}

/** Frames as they arrive (the latest one first), and status changes. */
export function subscribeLive(
  id: string,
  merchantId: string,
  onFrame: (frame: LiveFrame) => void,
  onStatus: (status: LiveStatus) => void,
): () => void {
  const s = owned(id, merchantId);
  s.touchedAt = Date.now();
  s.listeners.add(onFrame);
  s.statusListeners.add(onStatus);
  if (s.frame) onFrame(s.frame);
  return () => {
    s.listeners.delete(onFrame);
    s.statusListeners.delete(onStatus);
  };
}

export type LiveInput =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { type: 'key'; key: string; code?: string; modifiers?: number }
  | { type: 'text'; text: string }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' };

/** Keys that are not text: name -> Windows virtual key code, as Chrome expects. */
const KEYS: Record<string, number> = {
  Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32,
};

function clamp(n: unknown, max: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0;
}

/** Validate one input event from the viewer. Throws on anything malformed. */
export function parseLiveInput(raw: unknown): LiveInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const x = clamp(body.x, VIEWPORT.width);
  const y = clamp(body.y, VIEWPORT.height);
  switch (body.type) {
    case 'click':
      return { type: 'click', x, y, button: body.button === 'right' || body.button === 'middle' ? body.button : 'left', clickCount: body.clickCount === 2 ? 2 : 1 };
    case 'move':
      return { type: 'move', x, y };
    case 'scroll':
      return { type: 'scroll', x, y, dx: Math.max(-5000, Math.min(5000, Number(body.dx) || 0)), dy: Math.max(-5000, Math.min(5000, Number(body.dy) || 0)) };
    case 'key':
      if (typeof body.key !== 'string' || !(body.key in KEYS)) throw new LiveSessionError('invalid_request', 'Unsupported key');
      return { type: 'key', key: body.key, modifiers: Math.min(Math.max(Number(body.modifiers) || 0, 0), 15) };
    case 'text':
      if (typeof body.text !== 'string' || body.text.length === 0 || body.text.length > 2000) throw new LiveSessionError('invalid_request', 'text must be 1 to 2000 characters');
      return { type: 'text', text: body.text };
    case 'navigate':
      if (typeof body.url !== 'string') throw new LiveSessionError('invalid_request', 'url is required');
      return { type: 'navigate', url: body.url };
    case 'back':
    case 'forward':
    case 'reload':
      return { type: body.type };
    default:
      throw new LiveSessionError('invalid_request', 'Unknown input type');
  }
}

export async function sendLiveInput(id: string, merchantId: string, input: LiveInput): Promise<void> {
  const s = owned(id, merchantId);
  if (s.status !== 'live' || !s.page) throw new LiveSessionError('not_live', 'This sign-in session is not open', 409);
  s.touchedAt = Date.now();
  const { cdp } = s.browser;
  const page = s.page;
  switch (input.type) {
    case 'move':
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: input.x, y: input.y }, page);
      return;
    case 'click': {
      const base = { x: input.x, y: input.y, button: input.button ?? 'left', clickCount: input.clickCount ?? 1 };
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: input.x, y: input.y }, page);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, page);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, page);
      return;
    }
    case 'scroll':
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: input.x, y: input.y, deltaX: input.dx, deltaY: input.dy }, page);
      return;
    case 'key': {
      const code = KEYS[input.key]!;
      const key = input.key === 'Space' ? ' ' : input.key;
      const common = { key, code: input.key === 'Space' ? 'Space' : input.key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: input.modifiers ?? 0 };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common, ...(input.key === 'Enter' ? { text: '\r' } : input.key === 'Space' ? { text: ' ' } : {}) }, page);
      if (input.key === 'Enter' || input.key === 'Space') await cdp.send('Input.dispatchKeyEvent', { type: 'char', ...common, text: input.key === 'Enter' ? '\r' : ' ' }, page);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common }, page);
      return;
    }
    case 'text':
      await cdp.send('Input.insertText', { text: input.text }, page);
      return;
    case 'navigate': {
      const verdict = await checkUrl(input.url);
      if (!verdict.ok) throw new LiveSessionError('invalid_request', `That address cannot be opened: ${verdict.reason}`);
      await cdp.send('Page.navigate', { url: input.url }, page);
      return;
    }
    case 'back':
    case 'forward': {
      const { currentIndex, entries } = (await cdp.send('Page.getNavigationHistory', {}, page)) as { currentIndex: number; entries: { id: number }[] };
      const target = entries[currentIndex + (input.type === 'back' ? -1 : 1)];
      if (target) await cdp.send('Page.navigateToHistoryEntry', { entryId: target.id }, page);
      return;
    }
    case 'reload':
      await cdp.send('Page.reload', {}, page);
  }
}

/**
 * Save or abandon. Saving captures the session and records the page the
 * merchant finished on as where fetches start (unless it is a sign-in page).
 */
export async function finishLiveSession(id: string, access: { id: string; actorId: string }, save: boolean): Promise<{ status: LiveStatus; startUrl: string | null; cookies: number }> {
  const s = owned(id, access.id);
  if (!save) {
    expire(s, 'cancelled');
    return { status: 'cancelled', startUrl: null, cookies: 0 };
  }
  if (s.status !== 'live') throw new LiveSessionError('not_live', 'This sign-in session is not open', 409);
  setStatus(s, 'saving');
  try {
    const sf = await loadEngine();
    let state: SessionState = await captureState(s.browser.cdp, s.page);
    const startUrl = /^https:\/\//.test(s.url) && !sf.isSignInUrl(s.url) ? s.url : null;
    if (!state.cookies.length) throw new LiveSessionError('nothing_to_save', 'The bank set no cookies yet. Finish signing in first.', 409);
    state = { ...state };
    await saveSession({
      access,
      institutionKey: s.institutionKey,
      institutionLabel: s.institutionLabel,
      state,
      ...(startUrl ? { startUrl } : {}),
      status: 'active',
      login: true,
      lastStatus: 'signed in',
      nextFetchAt: new Date().toISOString(),
    });
    expire(s, 'saved');
    return { status: 'saved', startUrl, cookies: state.cookies.length };
  } catch (err) {
    if (err instanceof LiveSessionError && err.code === 'nothing_to_save') {
      setStatus(s, 'live');
      throw err;
    }
    expire(s, 'failed', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Test hook: how many Chromes and live sessions are open. */
export function cloudBrowserStats() {
  return { running, max: maxBrowsers(), live: [...live.values()].filter((s) => ['starting', 'live', 'saving'].includes(s.status)).length };
}
