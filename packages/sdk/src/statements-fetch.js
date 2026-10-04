/**
 * Statement fetching: download the original PDF statements behind every
 * linked account, straight from each bank, and keep them in CoinPay.
 *
 * SimpleFIN gives CoinPay balances and transactions and nothing else: the
 * protocol has no document endpoint and the Bridge keeps no PDFs. So this
 * runs on the merchant's own machine and goes to the banks:
 *
 * - The account list comes from CoinPay (`/finances/accounts`): institution,
 *   site and the last four digits of each account.
 * - Every bank gets its own Chrome profile, signed in once by a person in a
 *   real window (`coinpay finances statements login <bank>`). No bank
 *   password is asked for or stored; the session is the bank's own cookie,
 *   and it never leaves this machine.
 * - `fetch` drives that profile headless: open the statements page, click
 *   every control in a dated row that downloads a statement, catch the PDF
 *   through the DevTools download events, keep a copy under
 *   ~/.coinpay/statements/files, and import it into the statement library
 *   with its account and period. Each bank's run is reported as counts only.
 *
 * Bank pages change without notice, so nothing here knows a page's markup.
 * The finder looks for what every statements page has (a dated row with a
 * download or PDF control) and says what it saw. Needs Node 22+ (WebSocket).
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export class StatementFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StatementFetchError';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Accounts and institutions
// ---------------------------------------------------------------------------

/** The four digits an account name ends with: "SAPPHIRE (6496)", "Checking ...1234". */
export function lastFour(name) {
  const tail = /(\d{4})\)?\s*$/.exec(name || '');
  if (tail) return tail[1];
  const all = [...String(name || '').matchAll(/(?<!\d)(\d{4})(?!\d)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

export function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'bank';
}

/** secure.chase.com and chase.com are both `chase`. The server computes the same key. */
export function institutionKey(domain, name) {
  const host = String(domain || '').replace(/^https?:\/\//, '').split(/[/:]/)[0].toLowerCase();
  const labels = host.split('.').filter(Boolean);
  if (labels.length >= 2) {
    const second = labels[labels.length - 2];
    return slug(labels.length >= 3 && /^(co|com|org|net|gov|ac)$/.test(second) ? labels[labels.length - 3] : second);
  }
  return slug(name || host || 'bank');
}

/** CoinPay's account list, grouped by bank. */
export function groupInstitutions(accounts) {
  const byKey = new Map();
  for (const account of accounts || []) {
    if (account.is_hidden) continue;
    const key = institutionKey(account.org_domain, account.org_name);
    const entry = {
      id: account.id,
      name: account.name,
      last4: lastFour(account.name),
      institution: key,
    };
    const existing = byKey.get(key);
    if (existing) existing.accounts.push(entry);
    else {
      byKey.set(key, {
        key,
        name: account.org_name || account.org_domain || key,
        url: account.org_domain ? `https://${String(account.org_domain).replace(/^https?:\/\//, '')}` : null,
        accounts: [entry],
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** A bank named on the command line: its key, or the start of its key or name. */
export function pickInstitution(institutions, name) {
  const wanted = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = institutions.find((entry) => entry.key.replace(/-/g, '') === wanted);
  if (exact) return exact;
  const loose = institutions.filter((entry) => entry.key.replace(/-/g, '').startsWith(wanted) || entry.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(wanted));
  if (loose.length === 1) return loose[0];
  if (loose.length) throw new StatementFetchError(`"${name}" matches ${loose.map((entry) => entry.key).join(', ')}; be more specific`);
  throw new StatementFetchError(`no bank called "${name}" among your linked accounts (${institutions.map((entry) => entry.key).join(', ') || 'none linked'})`);
}

// ---------------------------------------------------------------------------
// Where each bank keeps its statements
// ---------------------------------------------------------------------------

/**
 * Sign-in pages for common banks. The statements page itself is learnt:
 * whatever page the person closes the login window on is where fetch starts,
 * so a bank not listed here works the same way from the site SimpleFIN names.
 */
export const DRIVERS = [
  { key: 'chase', login: 'https://secure.chase.com/web/auth/dashboard', statements: 'https://secure.chase.com/web/auth/dashboard#/dashboard/documents/myDocs/index;mode=documents' },
  { key: 'citi', login: 'https://online.citi.com/US/login.do' },
  { key: 'apple', login: 'https://card.apple.com/' },
  { key: 'americanexpress', login: 'https://www.americanexpress.com/en-us/account/login', statements: 'https://global.americanexpress.com/activity/statements' },
  { key: 'capitalone', login: 'https://verified.capitalone.com/auth/signin' },
  { key: 'discover', login: 'https://portal.discover.com/customersvcs/universalLogin/ac_main' },
  { key: 'wellsfargo', login: 'https://connect.secure.wellsfargo.com/auth/login/present' },
  { key: 'bankofamerica', login: 'https://secure.bankofamerica.com/login/sign-in/signOnV2Screen.go' },
  { key: 'usbank', login: 'https://onlinebanking.usbank.com/auth/login/' },
  { key: 'dcu', login: 'https://digital.dcu.org/' },
];

export function startUrls(institution, learnt) {
  const driver = DRIVERS.find((entry) => entry.key === institution.key);
  return {
    login: (driver && driver.login) || institution.url || null,
    fetch: learnt || (driver && (driver.statements || driver.login)) || institution.url || null,
  };
}

export function isSignInUrl(url) {
  return /log-?in|log-?on|sign-?in|sign-?on|logout|log-?off|sign-?off|auth\/(login|signin)|universallogin/i.test(url);
}

// ---------------------------------------------------------------------------
// Dates, periods, accounts
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function iso(year, month, day) {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** Every date in statement text or a file name, in the order written: [{date, precise}]. */
export function findDates(source) {
  const found = [];
  const add = (at, date, precise) => { if (date) found.push({ at, value: { date, precise } }); };
  const monthIndex = (word) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
  const year = (value) => (value.length === 2 ? 2000 + Number(value) : Number(value));
  const text = String(source || '');

  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) add(m.index, iso(+m[1], +m[2], +m[3]), true);
  for (const m of text.matchAll(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g)) add(m.index, iso(+m[1], +m[2], +m[3]), true);
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g)) add(m.index, iso(year(m[3]), +m[1], +m[2]), true);
  for (const m of text.matchAll(new RegExp(`(?<![a-z])${MONTH_WORD}\\.?[\\s_-]*(\\d{1,2})(?:st|nd|rd|th)?,?[\\s_-]+(\\d{4})(?!\\d)`, 'gi'))) add(m.index, iso(+m[3], monthIndex(m[1]), +m[2]), true);
  for (const m of text.matchAll(new RegExp(`(?<![a-z])${MONTH_WORD}\\.?[\\s_,-]+(\\d{4})(?!\\d)`, 'gi'))) add(m.index, iso(+m[2], monthIndex(m[1]), 1), false);
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})(?![-\d])/g)) add(m.index, iso(+m[1], +m[2], 1), false);

  found.sort((a, b) => a.at - b.at);
  return found
    .filter((entry, _i, all) => entry.value.precise || !all.some((other) => other.value.precise && other.value.date.slice(0, 7) === entry.value.date.slice(0, 7) && Math.abs(other.at - entry.at) < 20))
    .map((entry) => entry.value);
}

/** The closing month, and the statement's own range when one is printed. */
export function periodOf(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const dates = findDates(source);
    if (!dates.length) continue;
    const precise = dates.filter((entry) => entry.precise).map((entry) => entry.date).sort();
    if (precise.length >= 2) {
      const from = precise[0];
      const to = precise[precise.length - 1];
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days >= 20 && days <= 100) return { month: to.slice(0, 7), from, to };
    }
    const latest = dates.map((entry) => entry.date).sort().at(-1);
    return { month: latest.slice(0, 7), from: null, to: precise.includes(latest) ? latest : null };
  }
  return null;
}

/** The account a statement belongs to: by the last four digits it shows, or the bank's only account. */
export function matchAccount(accounts, ...sources) {
  if (accounts.length === 1) return accounts[0];
  const known = accounts.filter((entry) => entry.last4);
  for (const source of sources) {
    if (!source) continue;
    const hits = known.filter((entry) => new RegExp(`(?<!\\d)${entry.last4}(?!\\d)`).test(source));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** The import arguments for a period: the statement's own cycle (exclusive end) or its month. */
export function importPeriod(period) {
  if (!period) return null;
  if (period.from && period.to) {
    const end = new Date(`${period.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { from: period.from, to: end.toISOString().slice(0, 10), cycle: 'custom' };
  }
  return { period: period.month };
}

export function candidateKey(candidate) {
  if (candidate.href && !/[?&](token|session|nonce|ts|_)=/i.test(candidate.href)) return candidate.href;
  const period = periodOf(candidate.context, candidate.label);
  return `${candidate.label}|${period ? `${period.month}|${period.to || ''}` : String(candidate.context).slice(0, 80)}`;
}

export function isPdf(bytes) {
  return Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Local state: ~/.coinpay/statements
// ---------------------------------------------------------------------------

export function statementsHome(env = process.env) {
  return env.COINPAY_STATEMENTS_DIR || join(homedir(), '.coinpay', 'statements');
}

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new StatementFetchError(`${path} is not valid JSON (${err.message}); fix or remove it`);
  }
}

/** `{institutions: {key: {start, loggedInAt, lastFetchAt, lastStatus}}, entries: [...]}` */
export function loadLocal(home = statementsHome()) {
  const state = readJson(join(home, 'state.json'), {});
  state.institutions = state.institutions || {};
  state.entries = state.entries || [];
  return state;
}

export function saveLocal(state, home = statementsHome()) {
  writePrivateJson(join(home, 'state.json'), state);
}

export function profileDir(key, home = statementsHome()) {
  return join(home, 'profiles', key);
}

export function signedIn(key, home = statementsHome()) {
  return existsSync(join(profileDir(key, home), 'Default'));
}

/** Keep a copy of every statement on this machine, never overwriting a different file. */
export function archive(home, institution, account, period, suggestedName, bytes) {
  const folder = account ? join(institution.key, `${slug(account.name)}${account.last4 && !slug(account.name).includes(account.last4) ? `-${account.last4}` : ''}`) : join(institution.key, '_unfiled');
  const stem = account && period ? period.month : slug(basename(suggestedName || 'statement', '.pdf')) || 'statement';
  for (let attempt = 1; ; attempt += 1) {
    const relative = join(folder, `${stem}${attempt === 1 ? '' : `-${attempt}`}.pdf`);
    const absolute = join(home, 'files', relative);
    if (existsSync(absolute)) continue;
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    writeFileSync(absolute, bytes, { mode: 0o600 });
    return absolute;
  }
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function listDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const byVersionDesc = (a, b) => {
  const num = (s) => s.split(/[^0-9]+/).filter(Boolean).map(Number);
  const x = num(a);
  const y = num(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (y[i] || 0) - (x[i] || 0);
    if (d) return d;
  }
  return 0;
};

/** CHROME_PATH, then Chrome/Chromium on PATH, then the Puppeteer and Playwright caches, then macOS. */
export function findChrome(env = process.env, home = homedir()) {
  const candidates = [];
  if (env.CHROME_PATH) candidates.push(env.CHROME_PATH);
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    for (const dir of String(env.PATH || '').split(':').filter(Boolean)) candidates.push(join(dir, name));
  }
  candidates.push('/opt/google/chrome/chrome');
  const puppeteer = join(home, '.cache', 'puppeteer', 'chrome');
  for (const build of listDir(puppeteer).sort(byVersionDesc)) {
    const inner = listDir(join(puppeteer, build)).find((entry) => entry.startsWith('chrome'));
    if (inner) candidates.push(join(puppeteer, build, inner, 'chrome'));
  }
  const playwright = join(home, '.cache', 'ms-playwright');
  for (const build of listDir(playwright).sort(byVersionDesc)) {
    if (build.startsWith('chromium-')) candidates.push(join(playwright, build, 'chrome-linux', 'chrome'));
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  return candidates.find(isExecutable) || null;
}

export const NO_CHROME = 'no Chrome found. Set CHROME_PATH to a Chrome or Chromium binary, or install one (apt install chromium, brew install --cask google-chrome)';

/** The slice of the DevTools protocol this needs, over one flat-session socket. */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new StatementFetchError(message.error.message));
        else resolve(message.result || {});
        return;
      }
      if (message.method) for (const listener of this.listeners) listener(message);
    });
    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new StatementFetchError('browser closed'));
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitFor(method, sessionId, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.listeners.delete(listener); resolve(false); }, timeoutMs);
      const listener = (message) => {
        if (message.method === method && message.sessionId === sessionId) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(true);
        }
      };
      this.listeners.add(listener);
    });
  }
}

/** Make Chrome save a PDF instead of opening it in its viewer, where nothing is ever downloaded. */
export function preferPdfDownloads(profile) {
  const path = join(profile, 'Default', 'Preferences');
  let prefs = {};
  try {
    if (existsSync(path)) prefs = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    prefs = {};
  }
  prefs.plugins = { ...(prefs.plugins || {}), always_open_pdf_externally: true };
  prefs.download = { ...(prefs.download || {}), prompt_for_download: false };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(prefs));
}

/**
 * Start Chrome on a kept profile. Closing waits for a clean exit, because
 * cookies only reach disk then: a killed Chrome forgets a session the bank
 * refreshed during the run.
 */
/**
 * Who holds a profile. Chrome marks a profile in use with a SingletonLock
 * symlink whose target is "<hostname>-<pid>" (Linux and macOS).
 */
export function profileLock(profile) {
  try {
    const target = readlinkSync(join(profile, 'SingletonLock'));
    const dash = target.lastIndexOf('-');
    const pid = Number(target.slice(dash + 1));
    return dash > 0 && Number.isInteger(pid) ? { host: target.slice(0, dash), pid } : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** The command line of a process, or '' when it cannot be read. */
function commandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    const ps = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
    return ps.status === 0 ? ps.stdout : '';
  }
}

function removeLock(profile) {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(profile, name), { force: true });
}

/**
 * Make sure no other Chrome holds `profile` before we start one on it.
 *
 * A login or fetch that was interrupted (Ctrl+C, a closed terminal, a crash)
 * can leave Chrome running on the profile, or a lock pointing at a process
 * that is gone. Chrome then hands every new launch to the old instance and
 * exits, which looked like "open in another Chrome" forever. A dead or
 * reused pid is a stale lock and is removed; our own leftover headless Chrome
 * is stopped; a visible window is only closed with `force`.
 */
export async function releaseProfile(profile, { force = false } = {}) {
  const lock = profileLock(profile);
  if (!lock) return 'free';
  if (lock.host !== hostname()) {
    if (!force) throw new StatementFetchError(`the ${profile} profile is marked in use by ${lock.host}; if that machine is not using it, pass --force`);
    removeLock(profile);
    return 'stale';
  }
  const cmd = alive(lock.pid) ? commandLine(lock.pid) : '';
  if (!cmd.includes(`--user-data-dir=${profile}`)) {
    removeLock(profile);
    return 'stale';
  }
  if (!cmd.includes('--headless') && !force) {
    throw new StatementFetchError(`a Chrome window (pid ${lock.pid}) still has the ${basename(profile)} profile open; close it, or pass --force to close it for you`);
  }
  process.kill(lock.pid, 'SIGTERM');
  for (let i = 0; i < 50 && alive(lock.pid); i += 1) await sleep(100);
  if (alive(lock.pid)) process.kill(lock.pid, 'SIGKILL');
  for (let i = 0; i < 20 && alive(lock.pid); i += 1) await sleep(100);
  removeLock(profile);
  return 'stopped';
}

export async function openBrowser({ chrome, profile, headless = true, timeoutMs = 30_000, env = process.env, force = false }) {
  if (typeof WebSocket === 'undefined') throw new StatementFetchError('statement fetching needs Node 22 or newer (it drives Chrome over a WebSocket)');
  if (!chrome || !isExecutable(chrome)) throw new StatementFetchError(chrome ? `${chrome} is not an executable` : NO_CHROME);
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  await releaseProfile(profile, { force });
  preferPdfDownloads(profile);
  const sandbox = !(env.CHROME_NO_SANDBOX || process.getuid?.() === 0);
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-size=1280,900',
    ...(sandbox ? [] : ['--no-sandbox']),
    'about:blank',
  ];
  const child = spawn(chrome, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', () => resolve()));
  // Never leave Chrome holding the profile when we go: an orphan is what
  // makes the next run see the profile "open in another Chrome".
  const onExit = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
  const onSignal = (signal) => {
    onExit();
    detach();
    process.kill(process.pid, signal);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const detach = () => {
    process.removeListener('exit', onExit);
    for (const signal of signals) process.removeListener(signal, onSignal);
  };
  process.once('exit', onExit);
  for (const signal of signals) process.once(signal, onSignal);
  exited.then(detach);
  const url = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new StatementFetchError(`${chrome} did not start within ${timeoutMs / 1000}s\n${stderr}`)), timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const locked = /SingletonLock|ProcessSingleton|existing browser session/i.test(stderr);
      reject(new StatementFetchError(locked ? `another Chrome took over the ${basename(profile)} profile as this one started; run the command again, or pass --force` : `${chrome} exited with ${code} before it was ready\n${stderr.trim()}`));
    });
  }).catch((err) => {
    child.kill();
    throw err;
  });
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new StatementFetchError(`could not connect to ${url}`)), { once: true });
  });
  const cdp = new Cdp(socket);
  return {
    cdp,
    exited,
    async close() {
      try {
        await Promise.race([cdp.send('Browser.close'), sleep(2000)]);
      } catch {
        // already gone
      }
      await Promise.race([exited, sleep(10_000)]);
      socket.close();
      child.kill();
    },
  };
}

// ---------------------------------------------------------------------------
// In-page scripts
// ---------------------------------------------------------------------------

const ALL_DOCS = `const docs = [document];
  for (let i = 0; i < docs.length; i += 1) {
    for (const frame of docs[i].querySelectorAll('iframe, frame')) { try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch {} }
  }`;

/** True when the page asks for a password: the session is gone. */
export const SIGNED_OUT = `(() => {
  ${ALL_DOCS}
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  return docs.some((doc) => [...doc.querySelectorAll('input[type=password]')].some(visible));
})()`;

/** Follow the page's own "Statements" link, if it has one. */
export const OPEN_STATEMENTS = `(() => {
  const want = /^(e-?)?statements?(\\s*(&|and)\\s*(documents|disclosures))?$|^(view |my )?statements?$|^documents$/i;
  for (const el of document.querySelectorAll('a, button, [role=link], [role=tab], [role=menuitem]')) {
    const r = el.getBoundingClientRect();
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (label.length < 40 && want.test(label) && r.width > 0 && r.height > 0) { el.click(); return label; }
  }
  return null;
})()`;

/**
 * Every visible control that looks like it downloads one dated statement,
 * tagged data-stmt-i for clickScript. Row text is read with innerText, which
 * keeps the break between table cells ("1234" and "July" stay two words).
 */
export const COLLECT = `(() => {
  const DATE = /((?<![a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2},?\\s+)?\\d{4}\\b)|(\\b\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b)|(\\b\\d{4}-\\d{2}(-\\d{2})?\\b)/i;
  const SKIP = /preference|paperless|setting|notification|tax form|1099|privacy|agreement|terms|help|learn more|enroll/i;
  const ACTION = /statement|download|pdf|view|open|save/i;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const textOf = (el) => clean(el.innerText || el.textContent);
  const rowOf = (el) => {
    const row = el.closest('tr, li, [role=row], [role=listitem], article');
    if (row && textOf(row).length < 400) return row;
    let node = el;
    for (let i = 0; i < 4 && node.parentElement; i += 1) {
      node = node.parentElement;
      if (DATE.test(textOf(node)) && textOf(node).length < 300) return node;
    }
    return el;
  };
  ${ALL_DOCS}
  const out = [];
  let index = 0;
  for (const doc of docs) {
    for (const el of doc.querySelectorAll('a, button, [role=button], [role=link]')) {
      if (!visible(el)) continue;
      const label = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent);
      const href = el.getAttribute('href') || '';
      if (!/\\.pdf(\\b|$)/i.test(href) && !ACTION.test(label)) continue;
      if (SKIP.test(label)) continue;
      const context = textOf(rowOf(el)).slice(0, 300);
      if (!DATE.test(label + ' ' + context + ' ' + href)) continue;
      el.setAttribute('data-stmt-i', String(index));
      let absolute = null;
      if (href && !href.startsWith('#') && !/^javascript:/i.test(href)) { try { absolute = new URL(href, doc.baseURI).href; } catch {} }
      out.push({ index, label: label.slice(0, 120), context, href: absolute });
      index += 1;
    }
  }
  return JSON.stringify(out);
})()`;

export function clickScript(index) {
  return `(() => {
  ${ALL_DOCS}
  for (const doc of docs) { const el = doc.querySelector('[data-stmt-i="${Number(index)}"]'); if (el) { el.click(); return true; } }
  return false;
})()`;
}

/** A click that opened a dialog: press its Download button. */
export const SECOND_STEP = `(() => {
  const want = /^(download( pdf| statement)?|pdf|save( pdf)?|view pdf)$/i;
  for (const el of document.querySelectorAll('[role=dialog] button, [role=dialog] a, dialog button, dialog a, .modal button, .modal a, button, a')) {
    const r = el.getBoundingClientRect();
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (r.width > 0 && r.height > 0 && want.test(label) && !el.hasAttribute('data-stmt-i')) { el.click(); return label; }
  }
  return null;
})()`;

/** In assist mode: remember the row of whatever the person clicked last. */
export const CLICK_RECORDER = `document.addEventListener('click', (event) => {
  const el = event.target instanceof Element ? event.target.closest('a, button, [role=button], [role=link]') || event.target : null;
  if (!el) return;
  const row = el.closest('tr, li, [role=row], [role=listitem], article') || el.parentElement || el;
  window.__statementsLastClick = JSON.stringify({
    label: (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
    context: (row.innerText || row.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
  });
}, true);`;

// ---------------------------------------------------------------------------
// Driving a page
// ---------------------------------------------------------------------------

async function attachPage(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  let targetId = (targetInfos.find((t) => t.type === 'page') || {}).targetId;
  if (!targetId) ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  return { sessionId, targetId };
}

/** Headless Chrome names itself in its user agent, and banks turn that away. */
async function hideHeadless(cdp, sessionId) {
  const { userAgent } = await cdp.send('Browser.getVersion');
  if (userAgent.includes('Headless')) await cdp.send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') }, sessionId);
}

async function evaluate(cdp, sessionId, expression) {
  try {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    return exceptionDetails ? null : result.value ?? null;
  } catch {
    return null;
  }
}

async function navigate(cdp, sessionId, url, timeoutMs = 45_000) {
  const loaded = cdp.waitFor('Page.loadEventFired', sessionId, timeoutMs);
  const result = await cdp.send('Page.navigate', { url }, sessionId);
  if (result.errorText && result.errorText !== 'net::ERR_ABORTED') throw new StatementFetchError(`could not open ${url}: ${result.errorText}`);
  // A hash route never fires a load event; the poll that follows is what waits.
  await Promise.race([loaded, sleep(Math.min(timeoutMs, 15_000))]);
}

/** Browser-wide downloads, saved as dir/<guid> by allowAndName. */
class Downloads {
  constructor(cdp, dir) {
    this.dir = dir;
    this.begun = [];
    this.finished = new Map();
    this.waiters = new Set();
    this.stop = cdp.on(({ method, params }) => {
      if (method === 'Browser.downloadWillBegin') this.begun.push({ guid: String(params.guid), suggestedName: String(params.suggestedFilename || 'statement.pdf') });
      else if (method === 'Browser.downloadProgress' && (params.state === 'completed' || params.state === 'canceled')) this.finished.set(String(params.guid), params.state);
      else return;
      for (const wake of this.waiters) wake();
    });
  }

  static async start(cdp, dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const downloads = new Downloads(cdp, dir);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true });
    return downloads;
  }

  async until(check, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value !== null && value !== undefined) return value;
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await new Promise((resolve) => {
        const wake = () => { this.waiters.delete(wake); clearTimeout(timer); resolve(); };
        const timer = setTimeout(wake, left);
        this.waiters.add(wake);
      });
    }
  }

  next(after, timeoutMs) {
    return this.until(() => this.begun[after] ?? null, timeoutMs);
  }

  async bytes(event, timeoutMs = 120_000) {
    const state = await this.until(() => this.finished.get(event.guid) ?? null, timeoutMs);
    if (state !== 'completed') return null;
    const path = join(this.dir, event.guid);
    const bytes = readFileSync(path);
    rmSync(path, { force: true });
    return bytes;
  }
}

async function closeStrays(cdp, keep) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  for (const target of targetInfos) {
    if (target.type === 'page' && target.targetId !== keep) await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
  }
}

async function findCandidates(cdp, sessionId, renderMs) {
  const deadline = Date.now() + renderMs;
  let followed = false;
  for (;;) {
    if (await evaluate(cdp, sessionId, SIGNED_OUT)) return { signedOut: true, candidates: [] };
    const raw = await evaluate(cdp, sessionId, COLLECT);
    const candidates = raw ? JSON.parse(raw) : [];
    if (candidates.length) return { signedOut: false, candidates };
    if (!followed && Date.now() > deadline - renderMs / 2) followed = (await evaluate(cdp, sessionId, OPEN_STATEMENTS)) !== null;
    if (Date.now() > deadline) return { signedOut: false, candidates: [] };
    await sleep(1500);
  }
}

/**
 * Visit one bank's statements page and hand every new PDF to `onFile`.
 * `seen` holds candidate keys already fetched; returns the page's status.
 */
export async function fetchInstitution(browser, { start, seen = new Set(), since = null, max = 24, renderMs = 25_000, onFile, log = () => {} }) {
  const { cdp } = browser;
  const { sessionId, targetId } = await attachPage(cdp);
  await hideHeadless(cdp, sessionId);
  const staging = mkdtempSync(join(tmpdir(), 'coinpay-statements-'));
  const downloads = await Downloads.start(cdp, staging);
  try {
    await navigate(cdp, sessionId, start);
    let found = await findCandidates(cdp, sessionId, renderMs);
    const url = (await evaluate(cdp, sessionId, 'location.href')) || start;
    if (found.signedOut) return { status: 'login_needed', url, candidates: 0, silent: [] };
    if (!found.candidates.length) return { status: 'no_statements', url, candidates: 0, silent: [] };

    const todo = found.candidates
      .map((candidate) => ({ candidate, key: candidateKey(candidate), period: periodOf(candidate.context, candidate.label) }))
      .filter(({ key }) => !seen.has(key))
      .filter(({ period }) => !since || !period || period.month >= since)
      .filter((item, index, all) => all.findIndex((other) => other.key === item.key) === index)
      .slice(0, max);

    const silent = [];
    const total = found.candidates.length;
    for (const { candidate, key } of todo) {
      const label = `${candidate.label} | ${candidate.context}`.slice(0, 160);
      let clicked = await evaluate(cdp, sessionId, clickScript(candidate.index));
      if (!clicked) {
        // The last click navigated the tab; come back and find the same row.
        await navigate(cdp, sessionId, start);
        found = await findCandidates(cdp, sessionId, renderMs);
        const again = found.candidates.find((other) => candidateKey(other) === key);
        clicked = again ? await evaluate(cdp, sessionId, clickScript(again.index)) : false;
      }
      if (!clicked) { silent.push(label); continue; }
      const before = downloads.begun.length;
      let event = await downloads.next(before, 8000);
      if (!event && (await evaluate(cdp, sessionId, SECOND_STEP))) event = await downloads.next(before, 12_000);
      if (!event) { silent.push(label); await closeStrays(cdp, targetId); continue; }
      const bytes = await downloads.bytes(event);
      await closeStrays(cdp, targetId);
      if (!bytes) { silent.push(label); continue; }
      await onFile({ bytes, suggestedName: event.suggestedName, label: candidate.label, context: candidate.context, key });
      // A bank that sees forty clicks a second ends the session.
      await sleep(1200);
    }
    for (const line of silent) log(`  ? no download from: ${line}`);
    return { status: 'ok', url, candidates: total, silent };
  } finally {
    downloads.stop();
    rmSync(staging, { recursive: true, force: true });
  }
}

/** A sign-in window; resolves with the last real page when the person closes it. */
export async function loginWindow(browser, url) {
  const { cdp } = browser;
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  let last = null;
  const stop = cdp.on(({ method, params }) => {
    if (method !== 'Target.targetInfoChanged' && method !== 'Target.targetCreated') return;
    const info = params.targetInfo || {};
    if (info.type === 'page' && /^https:/.test(info.url || '')) last = info.url;
  });
  const { sessionId } = await attachPage(cdp);
  await navigate(cdp, sessionId, url).catch(() => {});
  await browser.exited;
  stop();
  return last && !isSignInUrl(last) ? last : null;
}

/** A window on the statements page; every PDF the person downloads goes to `onFile` until it closes. */
export async function assistWindow(browser, { start, onFile }) {
  const { cdp } = browser;
  const { sessionId } = await attachPage(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CLICK_RECORDER }, sessionId);
  const staging = mkdtempSync(join(tmpdir(), 'coinpay-statements-'));
  const downloads = await Downloads.start(cdp, staging);
  let open = true;
  browser.exited.then(() => { open = false; });
  let handled = 0;
  try {
    await navigate(cdp, sessionId, start).catch(() => {});
    await evaluate(cdp, sessionId, CLICK_RECORDER);
    while (open) {
      const event = await downloads.next(handled, 1000);
      if (!event) continue;
      handled += 1;
      const raw = await evaluate(cdp, sessionId, 'window.__statementsLastClick || null');
      const clicked = raw ? JSON.parse(raw) : { label: '', context: '' };
      const bytes = await downloads.bytes(event);
      if (bytes) await onFile({ bytes, suggestedName: event.suggestedName, label: clicked.label, context: clicked.context, key: null });
    }
  } finally {
    downloads.stop();
    rmSync(staging, { recursive: true, force: true });
  }
  return handled;
}

// ---------------------------------------------------------------------------
// The whole run: every signed-in bank → CoinPay
// ---------------------------------------------------------------------------

/**
 * Classify, archive and import one downloaded file. `importStatement` is
 * the SDK's importFinanceStatement bound to a client; `state` is the local
 * state, whose `entries` record every file by hash.
 */
export async function keepStatement({ institution, download, state, home, importStatement, how = 'fetch' }) {
  if (!isPdf(download.bytes)) return { status: 'not_pdf', name: download.suggestedName };
  const hash = sha256(download.bytes);
  const known = state.entries.find((entry) => entry.sha256 === hash);
  if (known) {
    if (download.key && !known.key) known.key = download.key;
    return { status: 'duplicate', entry: known };
  }
  const account = matchAccount(institution.accounts, download.context, download.suggestedName, download.label);
  const period = periodOf(download.context, download.suggestedName, download.label);
  const path = archive(home, institution, account, period, download.suggestedName, download.bytes);
  const entry = {
    sha256: hash,
    path,
    institution: institution.key,
    accountId: account ? account.id : null,
    month: period ? period.month : null,
    from: period ? period.from : null,
    to: period ? period.to : null,
    key: download.key,
    how,
    downloadedAt: new Date().toISOString(),
    statementId: null,
    importError: null,
  };
  state.entries.push(entry);
  const span = importPeriod(period);
  if (!account || !span) {
    entry.importError = account ? 'no statement period found in the row or file name' : 'account not recognised';
    return { status: 'unmatched', entry };
  }
  try {
    const data = await importStatement({ file: download.bytes, filename: download.suggestedName || `${period.month}.pdf`, accountId: account.id, institutionLabel: institution.name, ...span });
    entry.statementId = data && data.statement ? data.statement.id : null;
    return { status: data && data.duplicateOf ? 'duplicate' : 'imported', entry };
  } catch (err) {
    entry.importError = err && err.message ? err.message : String(err);
    return { status: 'import_failed', entry };
  }
}

/**
 * Fetch every signed-in bank (or the ones named) and import what is new.
 * `api` carries `listAccounts()`, `importStatement(opts)` and `reportRun(run)`.
 * Returns one summary per bank; never throws for one bank's failure.
 */
export async function runStatementFetch({ api, banks = [], since = null, max = 24, renderMs = 25_000, headless = true, chrome = findChrome(), home = statementsHome(), log = () => {}, client = 'coinpay-cli', force = false }) {
  const institutions = groupInstitutions(await api.listAccounts());
  if (!institutions.length) throw new StatementFetchError('no linked accounts; connect a bank in CoinPay first');
  const chosen = banks.length ? banks.map((name) => pickInstitution(institutions, name)) : institutions.filter((entry) => signedIn(entry.key, home));
  if (!chosen.length) throw new StatementFetchError(`no bank is signed in yet. Start with: coinpay finances statements login ${institutions[0].key}`);
  if (!chrome) throw new StatementFetchError(NO_CHROME);

  const state = loadLocal(home);
  const results = [];
  for (const institution of chosen) {
    const local = (state.institutions[institution.key] ||= {});
    const start = startUrls(institution, local.start).fetch;
    const startedAt = new Date().toISOString();
    const summary = { bank: institution.key, name: institution.name, status: 'ok', candidates: 0, imported: 0, duplicates: 0, unmatched: 0, failed: 0, silent: 0, message: null };
    log(`${institution.key}: ${start || 'no start page'}`);
    let browser;
    try {
      if (!signedIn(institution.key, home) || !start) {
        summary.status = 'login_needed';
        summary.message = `not signed in: coinpay finances statements login ${institution.key}`;
      } else {
        browser = await openBrowser({ chrome, profile: profileDir(institution.key, home), headless, force });
        const seen = new Set(state.entries.filter((entry) => entry.institution === institution.key && entry.key).map((entry) => entry.key));
        const page = await fetchInstitution(browser, {
          start, seen, since, max, renderMs, log,
          onFile: async (download) => {
            const kept = await keepStatement({ institution, download, state, home, importStatement: api.importStatement });
            if (kept.status === 'imported') summary.imported += 1;
            else if (kept.status === 'duplicate') summary.duplicates += 1;
            else if (kept.status === 'unmatched') summary.unmatched += 1;
            else if (kept.status === 'import_failed') summary.failed += 1;
            log(`  ${kept.status}: ${kept.entry ? kept.entry.path : kept.name}${kept.entry && kept.entry.importError ? ` (${kept.entry.importError})` : ''}`);
            saveLocal(state, home);
          },
        });
        summary.status = page.status;
        summary.candidates = page.candidates;
        summary.silent = page.silent.length;
        if (page.status === 'login_needed') summary.message = `the bank asks for a password again: coinpay finances statements login ${institution.key}`;
        if (page.status === 'no_statements') summary.message = `no statement links at ${new URL(page.url).origin}; sign in again and close the window on the statements list, or use assist`;
        if (summary.failed) summary.message = `${summary.failed} file(s) could not be imported; see coinpay finances statements local`;
      }
    } catch (err) {
      summary.status = 'error';
      summary.message = (err && err.message ? err.message : String(err)).slice(0, 400);
    } finally {
      if (browser) await browser.close();
      local.lastFetchAt = new Date().toISOString();
      local.lastStatus = summary.status;
      saveLocal(state, home);
    }
    log(`  ${summary.status}: ${summary.candidates} on the page, ${summary.imported} imported, ${summary.duplicates} already had, ${summary.unmatched} unmatched${summary.message ? `; ${summary.message}` : ''}`);
    try {
      await api.reportRun({
        institutionKey: institution.key,
        institutionLabel: institution.name,
        status: summary.status,
        candidates: summary.candidates,
        filed: summary.imported,
        duplicates: summary.duplicates,
        unmatched: summary.unmatched + summary.failed,
        silent: summary.silent,
        message: summary.message,
        client,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      log(`  (could not report the run to CoinPay: ${err && err.message ? err.message : err})`);
    }
    results.push(summary);
  }
  return results;
}

/** The three calls a run makes, bound to an authenticated CoinPay client. */
export async function clientApi(client) {
  const [{ listFinanceAccounts }, reports] = await Promise.all([import('./finances.js'), import('./finances-reports.js')]);
  return {
    listAccounts: () => listFinanceAccounts(client),
    importStatement: (opts) => reports.importFinanceStatement(client, opts),
    reportRun: (run) => reports.reportStatementFetchRun(client, run),
  };
}

/** Re-import local files whose import failed or never happened (e.g. after linking an account). */
export async function retryImports({ api, home = statementsHome(), log = () => {} }) {
  const state = loadLocal(home);
  const institutions = groupInstitutions(await api.listAccounts());
  const out = { imported: 0, skipped: 0, failed: 0 };
  for (const entry of state.entries.filter((e) => !e.statementId)) {
    const institution = institutions.find((i) => i.key === entry.institution);
    const account = institution && institution.accounts.find((a) => a.id === entry.accountId);
    const span = importPeriod(entry.month ? { month: entry.month, from: entry.from, to: entry.to } : null);
    if (!account || !span || !existsSync(entry.path)) { out.skipped += 1; continue; }
    try {
      const data = await api.importStatement({ file: readFileSync(entry.path), filename: basename(entry.path), accountId: account.id, institutionLabel: institution.name, ...span });
      entry.statementId = data && data.statement ? data.statement.id : null;
      entry.importError = null;
      out.imported += 1;
      log(`imported ${entry.path}`);
    } catch (err) {
      entry.importError = err.message;
      out.failed += 1;
      log(`failed ${entry.path}: ${err.message}`);
    }
    saveLocal(state, home);
  }
  return out;
}
