/**
 * Statement fetching: the pure parts, and a whole run against a fake bank
 * in a real headless Chrome (skipped where no Chrome is installed).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import * as os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  candidateKey,
  findChrome,
  findDates,
  groupInstitutions,
  importPeriod,
  institutionKey,
  lastFour,
  loadLocal,
  matchAccount,
  openBrowser,
  periodOf,
  pickInstitution,
  profileDir,
  profileLock,
  releaseProfile,
  runStatementFetch,
  startUrls,
} from '../src/statements-fetch.js';

const PDF = (marker) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`, 'latin1');

const coinpayAccounts = [
  { id: 'a1', name: 'SAPPHIRE (6496)', org_name: 'Chase', org_domain: 'chase.com', is_hidden: false },
  { id: 'a2', name: 'TOTAL CHECKING (1234)', org_name: 'Chase', org_domain: 'www.chase.com', is_hidden: false },
  { id: 'a3', name: 'Coastal Cash Visa', org_name: 'Bay Federal Credit Union', org_domain: null, is_hidden: false },
  { id: 'a4', name: 'Old', org_name: 'Gone', org_domain: 'gone.com', is_hidden: true },
];

describe('releaseProfile: a profile left locked by an earlier run', () => {
  const { hostname } = os;
  const lockTo = (profile, target) => {
    mkdirSync(profile, { recursive: true });
    rmSync(join(profile, 'SingletonLock'), { force: true });
    symlinkSync(target, join(profile, 'SingletonLock'));
  };
  // A stand-in for Chrome: a process whose command line names the profile.
  const fakeChrome = (profile, headless) =>
    spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profile}`, ...(headless ? ['--headless=new'] : [])], { stdio: 'ignore' });
  const waitExit = (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve)));

  it('is free when nothing holds it', async () => {
    expect(await releaseProfile(mkdtempSync(join(tmpdir(), 'cp-lock-')))).toBe('free');
  });

  it('removes a lock whose process is gone, or is some other program now', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'cp-lock-'));
    lockTo(profile, `${hostname()}-999999`);
    expect(await releaseProfile(profile)).toBe('stale');
    expect(profileLock(profile)).toBeNull();
    lockTo(profile, `${hostname()}-${process.pid}`);
    expect(await releaseProfile(profile)).toBe('stale');
  });

  it('stops our own orphaned headless Chrome', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'cp-lock-'));
    const orphan = fakeChrome(profile, true);
    await new Promise((r) => setTimeout(r, 200));
    lockTo(profile, `${hostname()}-${orphan.pid}`);
    expect(await releaseProfile(profile)).toBe('stopped');
    await waitExit(orphan);
    expect(profileLock(profile)).toBeNull();
  });

  it('refuses to close a visible window unless forced', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'cp-lock-'));
    const window = fakeChrome(profile, false);
    await new Promise((r) => setTimeout(r, 200));
    lockTo(profile, `${hostname()}-${window.pid}`);
    await expect(releaseProfile(profile)).rejects.toThrow(/still has the .* profile open.*--force/);
    expect(await releaseProfile(profile, { force: true })).toBe('stopped');
    await waitExit(window);
  });

  it('will not touch a lock from another machine without --force', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'cp-lock-'));
    lockTo(profile, 'some-other-laptop-1234');
    await expect(releaseProfile(profile)).rejects.toThrow(/some-other-laptop/);
    expect(await releaseProfile(profile, { force: true })).toBe('stale');
  });
});

describe('accounts and banks', () => {
  it('groups CoinPay accounts by bank, skipping hidden ones', () => {
    const banks = groupInstitutions(coinpayAccounts);
    expect(banks.map((b) => [b.key, b.accounts.length])).toEqual([['bay-federal-credit-union', 1], ['chase', 2]]);
    expect(banks[1].accounts[0]).toMatchObject({ id: 'a1', last4: '6496' });
  });

  it('keys banks the way the server does', () => {
    expect(institutionKey('secure.chase.com', 'Chase')).toBe('chase');
    expect(institutionKey('www.barclays.co.uk', null)).toBe('barclays');
  });

  it('picks a bank by key or name prefix and explains a miss', () => {
    const banks = groupInstitutions(coinpayAccounts);
    expect(pickInstitution(banks, 'CHASE').key).toBe('chase');
    expect(pickInstitution(banks, 'bay').key).toBe('bay-federal-credit-union');
    expect(() => pickInstitution(banks, 'citi')).toThrow(/no bank or tax source called "citi"/);
  });

  it('starts at the learnt page, then the known statements page, then the bank site', () => {
    expect(startUrls({ key: 'chase', url: null }, 'https://secure.chase.com/x').fetch).toBe('https://secure.chase.com/x');
    expect(startUrls({ key: 'chase', url: null }).fetch).toContain('documents');
    expect(startUrls({ key: 'tiny', url: 'https://tiny.org' })).toEqual({ login: 'https://tiny.org', fetch: 'https://tiny.org' });
  });
});

describe('dates, periods, accounts', () => {
  it('reads dates however banks print them', () => {
    expect(findDates('20260815-statements-6496-.pdf')).toEqual([{ date: '2026-08-15', precise: true }]);
    expect(findDates('Statement_Aug_2026_1234.pdf')).toEqual([{ date: '2026-08-01', precise: false }]);
    expect(findDates('Account ending 1234July 2026')).toEqual([{ date: '2026-07-01', precise: false }]);
  });

  it('turns a printed cycle into an import range with an exclusive end', () => {
    const period = periodOf('Statement 07/16/2026 - 08/15/2026');
    expect(period).toEqual({ month: '2026-08', from: '2026-07-16', to: '2026-08-15' });
    expect(importPeriod(period)).toEqual({ from: '2026-07-16', to: '2026-08-16', cycle: 'custom' });
    expect(importPeriod(periodOf('August 2026'))).toEqual({ period: '2026-08' });
    expect(importPeriod(null)).toBeNull();
  });

  it('matches an account by its last four, or the only account', () => {
    const [chase] = groupInstitutions(coinpayAccounts).filter((b) => b.key === 'chase');
    expect(matchAccount(chase.accounts, 'ending 1234')?.id).toBe('a2');
    expect(matchAccount(chase.accounts, 'no digits')).toBeNull();
    expect(lastFour('Coastal Cash Visa')).toBeNull();
  });

  it('keys a row by its link unless the link is a session token', () => {
    expect(candidateKey({ label: 'Download', context: '', href: 'https://b/doc/1.pdf' })).toBe('https://b/doc/1.pdf');
    expect(candidateKey({ label: 'Download', context: 'Aug 15, 2026', href: 'https://b/doc?token=x' })).toBe('Download|2026-08|2026-08-15');
  });
});

const chrome = findChrome();
describe.skipIf(!chrome || typeof WebSocket === 'undefined')('a whole fetch against a fake bank', () => {
  let server;
  let base = '';
  const work = mkdtempSync(join(tmpdir(), 'coinpay-statements-e2e-'));

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const signedIn = /(^|;\s*)s=1/.test(req.headers.cookie || '');
      if (url.pathname === '/set') {
        res.writeHead(302, { 'Set-Cookie': 's=1; Path=/; Max-Age=3600', Location: '/statements' });
        res.end();
      } else if (url.pathname === '/statements' && !signedIn) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<form><input name=u><input type=password name=p></form>');
      } else if (url.pathname === '/statements') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><body><table>
          <tr><td>Account ending 6496</td><td>Statement 07/16/2026 - 08/15/2026</td><td><a href="/pdf/aug">Download</a></td></tr>
          <tr><td>Account ending 1234</td><td>July 2026</td><td><button onclick="document.getElementById('d').hidden=false">View statement</button></td></tr>
          <tr><td>Account ending 9999</td><td>June 2026</td><td><a href="/inline/jun">PDF</a></td></tr>
          <tr><td>Updated 08/01/2026</td><td><a href="/prefs">Statement preferences</a></td></tr>
        </table><div role=dialog id=d hidden><button onclick="location.href='/pdf/jul'">Download</button></div></body>`);
      } else if (url.pathname.startsWith('/pdf/')) {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="statement-${url.pathname.slice(5)}.pdf"` });
        res.end(PDF(url.pathname));
      } else if (url.pathname === '/inline/jun') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(PDF('inline-jun'));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => {
    server?.close();
    rmSync(work, { recursive: true, force: true });
  });

  it('reports a lost session, then imports each statement with its account and period, once', { timeout: 120_000 }, async () => {
    const home = join(work, 'home');
    const imports = [];
    const runs = [];
    const api = {
      listAccounts: async () => [
        { id: 'a1', name: 'SAPPHIRE (6496)', org_name: 'Fake Bank', org_domain: 'fakebank.test' },
        { id: 'a2', name: 'CHECKING (1234)', org_name: 'Fake Bank', org_domain: 'fakebank.test' },
      ],
      importStatement: async (opts) => {
        imports.push({ ...opts, file: undefined });
        return { statement: { id: `stmt-${imports.length}` }, duplicateOf: null };
      },
      reportRun: async (run) => runs.push(run),
    };
    // What `login` leaves behind: a learnt start page and a profile.
    mkdirSync(join(profileDir('fakebank', home), 'Default'), { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(home, 'state.json'), JSON.stringify({ institutions: { fakebank: { start: `${base}/statements` } } }));
    const options = { api, home, chrome, renderMs: 4000 };

    let [first] = await runStatementFetch(options);
    expect(first).toMatchObject({ bank: 'fakebank', status: 'login_needed' });
    expect(runs[0]).toMatchObject({ institutionKey: 'fakebank', status: 'login_needed', filed: 0 });

    const browser = await openBrowser({ chrome, profile: profileDir('fakebank', home) });
    const { targetId } = await browser.cdp.send('Target.createTarget', { url: `${base}/set` });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await browser.cdp.send('Target.closeTarget', { targetId });
    await browser.close();

    [first] = await runStatementFetch(options);
    expect(first).toMatchObject({ status: 'ok', candidates: 3, imported: 2, unmatched: 1 });
    expect(imports).toEqual([
      expect.objectContaining({ accountId: 'a1', from: '2026-07-16', to: '2026-08-16', cycle: 'custom', institutionLabel: 'Fake Bank' }),
      expect.objectContaining({ accountId: 'a2', period: '2026-07' }),
    ]);
    const local = loadLocal(home);
    expect(local.entries.find((e) => e.accountId === null)).toMatchObject({ importError: 'account not recognised', month: '2026-06' });
    expect(runs[1]).toMatchObject({ status: 'ok', filed: 2, unmatched: 1, client: 'coinpay-cli' });

    [first] = await runStatementFetch(options);
    expect(first).toMatchObject({ status: 'ok', imported: 0, duplicates: 0 });
    expect(imports).toHaveLength(2);
  });
});
