import 'server-only';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import path from 'path';
import { filesDir } from './files';
import { installRequestGuard } from './bank-guard';
import { loadEngine } from './cloud-browser';
import { restoreState, type SessionState } from './bank-sessions';

/**
 * One long-running Chrome per connected bank.
 *
 * Restoring cookies into a fresh browser did not hold real bank sessions:
 * Chase, Alliant and American Express all ended within the hour, Amex nine
 * minutes after a touch that read it as alive. Banks tie a session to more
 * than cookies: storage, in-page tokens, the browser itself. So each bank now
 * keeps the very browser the merchant signed in with:
 *
 *   - the sign-in streams this browser, keep-alive refreshes inside it, and
 *     fetches run inside it, one at a time (a per-bank lock);
 *   - its profile lives on the files volume (FINANCES_FILES_DIR/bank-profiles/
 *     <merchant>/<bank>), with Chrome's session restore on, so a deploy that
 *     restarts the container reopens the same profile; the sealed cookie copy
 *     (bank-sessions.ts) is put back on every fresh launch as well;
 *   - it is fenced (bank-guard.ts) once, at launch, for every tab it opens.
 *
 * At rest the profile is protected only by Chrome's own Linux cookie
 * encryption, which is weak; that is the trade Anthony chose for surviving
 * deploys. The volume is private to the app container.
 *
 * At most FINANCES_BANK_BROWSERS_MAX (default 8) run at once; past that the
 * least recently used idle one is closed (its profile and sealed copy stay).
 */

type Engine = Awaited<ReturnType<typeof loadEngine>>;
type Browser = Awaited<ReturnType<Engine['openBrowser']>>;
type Check = (url: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
type TargetInfo = { sessionId: string; targetId: string; type: string; url: string };

export interface BankBrowser {
  key: string;
  merchantId: string;
  institutionKey: string;
  browser: Browser;
  /** The session id of the bank's main tab. */
  page: string;
  launchedAt: number;
  lastUsedAt: number;
  /** True only for the acquire that launched it, so the caller knows a restore happened. */
  fresh: boolean;
  onTarget(listener: (info: TargetInfo) => void): () => void;
}

interface Entry {
  bb: BankBrowser;
  lock: Promise<void>;
  busy: number;
  stopGuard: () => void;
  targetListeners: Set<(info: TargetInfo) => void>;
}

const entries = new Map<string, Entry>();
const launching = new Map<string, Promise<Entry>>();
const UUID = /^[0-9a-f-]{36}$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;

function maxBankBrowsers(): number {
  const n = Number(process.env.FINANCES_BANK_BROWSERS_MAX ?? 8);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 40) : 8;
}

export function bankProfileDir(merchantId: string, institutionKey: string): string {
  if (!UUID.test(merchantId) || !KEY.test(institutionKey)) throw new Error('Invalid bank profile key');
  // Resolved and confined to the bank-profiles directory, whatever the parts say.
  const root = path.resolve(filesDir(), 'bank-profiles');
  const dir = path.resolve(root, merchantId, institutionKey);
  if (!dir.startsWith(root + path.sep)) throw new Error('Invalid bank profile key');
  return dir;
}

/** Chrome preferences for a kept profile: reopen the last session (keeps session cookies), save PDFs, no crash bubble. */
export function prepareProfile(profile: string): void {
  mkdirSync(path.join(profile, 'Default'), { recursive: true, mode: 0o700 });
  const prefsPath = path.join(profile, 'Default', 'Preferences');
  let prefs: Record<string, any> = {};
  try {
    if (existsSync(prefsPath)) prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
  } catch {
    prefs = {};
  }
  prefs.session = { ...(prefs.session ?? {}), restore_on_startup: 1 };
  prefs.profile = { ...(prefs.profile ?? {}), exit_type: 'Normal', exited_cleanly: true };
  prefs.plugins = { ...(prefs.plugins ?? {}), always_open_pdf_externally: true };
  prefs.download = { ...(prefs.download ?? {}), prompt_for_download: false };
  writeFileSync(prefsPath, JSON.stringify(prefs), { mode: 0o600 });
}

async function evictIdle(): Promise<void> {
  if (entries.size < maxBankBrowsers()) return;
  const idle = [...entries.values()].filter((e) => e.busy === 0).sort((a, b) => a.bb.lastUsedAt - b.bb.lastUsedAt)[0];
  if (!idle) throw Object.assign(new Error('Every bank browser is busy; try again in a minute'), { code: 'cloud_browser_busy', status: 429 });
  await closeBankBrowser(idle.bb.merchantId, idle.bb.institutionKey);
}

async function launch(merchantId: string, institutionKey: string, options: { restore?: () => Promise<SessionState | null>; check?: Check }): Promise<Entry> {
  await evictIdle();
  const sf = await loadEngine();
  const chrome = process.env.CHROME_PATH || sf.findChrome();
  if (!chrome) throw new Error('No Chromium on this server (set CHROME_PATH)');
  const profile = bankProfileDir(merchantId, institutionKey);
  prepareProfile(profile);
  // force: only this process uses these profiles, and the lock left by the
  // previous container (another hostname) is always stale.
  const browser = await sf.openBrowser({
    chrome,
    profile,
    headless: true,
    handleSignals: false,
    force: true,
    extraArgs: ['--disable-dev-shm-usage', '--disable-gpu', '--disable-features=Translate,MediaRouter', '--lang=en-US', '--restore-last-session'],
  });
  const key = `${merchantId}:${institutionKey}`;
  const targetListeners = new Set<(info: TargetInfo) => void>();
  let page: string | null = null;
  let stopGuard: () => void = () => undefined;
  try {
    await browser.cdp.send('Target.setDiscoverTargets', { discover: true });
    stopGuard = await installRequestGuard(browser.cdp, {
      ...(options.check ? { check: options.check } : {}),
      onTarget: (info) => {
        if (info.type === 'page' && !info.url.startsWith('chrome') && !page) page = info.sessionId;
        for (const listener of targetListeners) listener(info);
      },
    });
    for (let i = 0; i < 50 && !page; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (!page) throw new Error('The bank browser opened no tab');
    const { userAgent } = (await browser.cdp.send('Browser.getVersion')) as { userAgent: string };
    await browser.cdp.send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome'), acceptLanguage: 'en-US,en' }, page).catch(() => undefined);
    await browser.cdp.send('Page.enable', {}, page).catch(() => undefined);
    const state = options.restore ? await options.restore() : null;
    if (state) await restoreState(browser.cdp, page, state);
  } catch (err) {
    stopGuard();
    await browser.close().catch(() => undefined);
    throw err;
  }
  const now = Date.now();
  const entry: Entry = {
    bb: {
      key,
      merchantId,
      institutionKey,
      browser,
      page: page!,
      launchedAt: now,
      lastUsedAt: now,
      fresh: true,
      onTarget: (listener) => {
        targetListeners.add(listener);
        return () => targetListeners.delete(listener);
      },
    },
    lock: Promise.resolve(),
    busy: 0,
    stopGuard,
    targetListeners,
  };
  browser.exited.then(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return entry;
}

/**
 * The bank's browser, launched if it is not running, held exclusively until
 * `release()`. `restore` supplies the sealed session for a fresh launch.
 */
export async function acquireBankBrowser(
  merchantId: string,
  institutionKey: string,
  options: { restore?: () => Promise<SessionState | null>; check?: Check } = {},
): Promise<{ bb: BankBrowser; release: () => void }> {
  const key = `${merchantId}:${institutionKey}`;
  let entry = entries.get(key);
  let fresh = false;
  if (!entry) {
    let pending = launching.get(key);
    if (!pending) {
      pending = launch(merchantId, institutionKey, options).finally(() => launching.delete(key));
      launching.set(key, pending);
      fresh = true;
    }
    entry = await pending;
    entries.set(key, entry);
  }
  const current = entry;
  current.busy += 1;
  let unlock!: () => void;
  const previous = current.lock;
  current.lock = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  current.bb.lastUsedAt = Date.now();
  let released = false;
  return {
    bb: { ...current.bb, fresh },
    release: () => {
      if (released) return;
      released = true;
      current.busy -= 1;
      current.bb.lastUsedAt = Date.now();
      unlock();
    },
  };
}

/** Close a bank's browser; with deleteProfile, also forget its profile on the volume. */
export async function closeBankBrowser(merchantId: string, institutionKey: string, { deleteProfile = false }: { deleteProfile?: boolean } = {}): Promise<void> {
  const key = `${merchantId}:${institutionKey}`;
  const entry = entries.get(key);
  entries.delete(key);
  if (entry) {
    entry.stopGuard();
    await entry.bb.browser.close().catch(() => undefined);
  }
  if (deleteProfile) await rm(bankProfileDir(merchantId, institutionKey), { recursive: true, force: true }).catch(() => undefined);
}

export function bankBrowserStats() {
  return { running: entries.size, max: maxBankBrowsers(), keys: [...entries.keys()] };
}

/** Test hook. */
export async function closeAllBankBrowsers(): Promise<void> {
  for (const entry of [...entries.values()]) await closeBankBrowser(entry.bb.merchantId, entry.bb.institutionKey);
}
