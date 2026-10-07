/**
 * Tax document sources (FTB, IRS): standalone sources, the tax collector,
 * filing into the document library, and the attempt throttle. The e2e runs a
 * fake agency site in a real headless Chrome (skipped without Chrome).
 *
 * No real personal data: names, notice numbers and years are made up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

import {
  classifyTaxDocument,
  COLLECT,
  COLLECT_TAX,
  detectLockout,
  evaluateThrottle,
  findChrome,
  groupInstitutions,
  institutionKey,
  isTaxSource,
  keepCandidate,
  keepTaxDocument,
  loadLocal,
  loadThrottle,
  lockoutUntil,
  pickInstitution,
  profileDir,
  recordLocalLockout,
  runStatementFetch,
  standaloneSources,
  startUrls,
  takeLocalAttempt,
  TAX_THROTTLE,
  withStandaloneSources,
} from '../src/statements-fetch.js';

const PDF = (marker) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`, 'latin1');
const home = () => mkdtempSync(join(tmpdir(), 'coinpay-tax-'));

describe('standalone tax sources', () => {
  it('resolve without any linked bank', () => {
    expect(pickInstitution([], 'ftb')).toMatchObject({ key: 'ftb', kind: 'tax', accounts: [] });
    expect(pickInstitution([], 'IRS').key).toBe('irs');
    expect(pickInstitution([], 'irs-business').key).toBe('irs-business');
    expect(pickInstitution([], 'california').key).toBe('ftb'); // by name prefix
    expect(() => pickInstitution([], 'hmrc')).toThrow(/tax sources: ftb, irs, irs-business/);
  });

  it('merge after the linked banks, and a linked bank keeps its key', () => {
    const linked = groupInstitutions([{ id: 'a1', name: 'CHECKING (1234)', org_name: 'Example Bank', org_domain: 'examplebank.test' }]);
    expect(withStandaloneSources(linked).map((i) => i.key)).toEqual(['examplebank', 'ftb', 'irs', 'irs-business', 'webull']);
    const clash = [{ key: 'irs', name: 'Irs Credit Union', url: 'https://irs-cu.test', accounts: [{ id: 'x', name: 'S (0001)', last4: '0001', institution: 'irs' }] }];
    const merged = withStandaloneSources(clash);
    expect(merged.filter((i) => i.key === 'irs')).toHaveLength(1);
    expect(isTaxSource(merged.find((i) => i.key === 'irs'))).toBe(false);
    expect(standaloneSources().filter((s) => s.kind === 'tax').every((s) => isTaxSource(s))).toBe(true);
  });

  it('start at the agency sign-in page', () => {
    expect(startUrls(pickInstitution([], 'ftb'))).toEqual({ login: 'https://webapp.ftb.ca.gov/MyFTBAccess/', fetch: 'https://webapp.ftb.ca.gov/MyFTBAccess/' });
    expect(startUrls(pickInstitution([], 'irs')).login).toBe('https://sa.www4.irs.gov/ola/');
    expect(startUrls(pickInstitution([], 'irs-business')).login).toBe('https://sa.www4.irs.gov/bola/');
    expect(startUrls(pickInstitution([], 'ftb'), 'https://webapp.ftb.ca.gov/MyFTB/notices').fetch).toBe('https://webapp.ftb.ca.gov/MyFTB/notices');
  });

  it('key agency hosts explicitly, not by their second-level label', () => {
    expect(institutionKey('webapp.ftb.ca.gov', null)).toBe('ftb');
    expect(institutionKey('https://www.ftb.ca.gov/pay', null)).toBe('ftb');
    expect(institutionKey('sa.www4.irs.gov', null)).toBe('irs');
    expect(institutionKey('irs.gov', null)).toBe('irs');
    expect(institutionKey('www.cdtfa.ca.gov', null)).toBe('ca'); // unchanged for hosts not on the list
  });
});

describe('the tax collector', () => {
  it('keeps notices, letters and transcripts that a bank page skips', () => {
    expect(keepCandidate('tax', 'Notice', 'Notice of Tax Return Change 03/14/2025', '')).toBe(true);
    expect(keepCandidate('tax', 'View Transcript', 'Account Transcript Tax Year 2024', '')).toBe(true);
    expect(keepCandidate('tax', 'CP2000', 'Proposed changes', '/x')).toBe(true);
    expect(keepCandidate('tax', 'Letter', 'LTR 3172 Notice of federal tax lien', '')).toBe(true);
    expect(keepCandidate('tax', 'Download', 'Form 1099-G 2024', '')).toBe(true);
    expect(keepCandidate('tax', 'anything', '', '/docs/notice-123.pdf')).toBe(true);
    // A bank page still skips them:
    expect(keepCandidate('statements', 'Tax form 1099', 'Jan 2025', '')).toBe(false);
    expect(keepCandidate('statements', 'Download', 'Statement Jan 2025', '')).toBe(true);
  });

  it('skips account chrome on a tax site', () => {
    expect(keepCandidate('tax', 'Notification preferences', 'Notices 2025', '')).toBe(false);
    expect(keepCandidate('tax', 'Make a payment', '2025', '')).toBe(false);
    expect(keepCandidate('tax', 'Log out', '', '')).toBe(false);
    expect(keepCandidate('tax', 'View', 'nothing dated here', '')).toBe(false);
  });

  it('runs in a page: the collector source carries its own filter', () => {
    const dom = new JSDOM(`<!doctype html><body><table>
      <tr><td>03/14/2025</td><td>Notice of Tax Return Change</td><td><a href="/n/1">View Notice</a></td></tr>
      <tr><td>Tax Year 2024</td><td>Account Transcript</td><td><button>View Transcript</button></td></tr>
      <tr><td>01/02/2025</td><td><a href="/prefs">Notification preferences</a></td></tr>
    </table></body>`, { runScripts: 'outside-only', url: 'https://agency.test/notices' });
    dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 });
    const tax = JSON.parse(dom.window.eval(COLLECT_TAX));
    expect(tax.map((c) => c.label)).toEqual(['View Notice', 'View Transcript']);
    expect(tax[0].href).toBe('https://agency.test/n/1');
    expect(JSON.parse(dom.window.eval(COLLECT))).toHaveLength(0);
  });
});

describe('classifying a tax document', () => {
  const at = new Date('2026-10-04T12:00:00Z');
  it('reads the tax year, the notice date, a notice code and the type', () => {
    expect(classifyTaxDocument({ label: 'View Transcript', context: 'Account Transcript Tax Year 2024', suggestedName: 'transcript.pdf' }, at))
      .toMatchObject({ docType: 'transcript', taxYear: 2024, periodLabel: '2024', title: 'Account Transcript Tax Year 2024' });
    expect(classifyTaxDocument({ label: 'Notice of Tax Return Change', context: '03/14/2025 Notice of Tax Return Change', suggestedName: '' }, at))
      .toMatchObject({ docType: 'notice', taxYear: null, noticeDate: '2025-03-14', periodLabel: '2025-03-14', title: 'Notice of Tax Return Change' });
    expect(classifyTaxDocument({ label: 'CP2000', context: '', suggestedName: 'CP2000_2023.pdf' }, at)).toMatchObject({ docType: 'notice', code: 'CP2000' });
    expect(classifyTaxDocument({ label: 'Download', context: '', suggestedName: 'doc.pdf' }, at)).toMatchObject({ docType: 'other', periodLabel: '2026-10-04', title: 'doc' });
  });
});

describe('filing a tax document', () => {
  it('archives it, files it under Documents as tax, and keeps one copy', async () => {
    const dir = home();
    const state = loadLocal(dir);
    const filed = [];
    const fileDocument = async (opts) => {
      filed.push({ ...opts, file: undefined });
      return { document: { id: `doc-${filed.length}` }, duplicate: false };
    };
    const ftb = pickInstitution([], 'ftb');
    const download = { bytes: PDF('ftb-notice'), suggestedName: 'notice.pdf', label: 'Notice of Proposed Assessment', context: 'Tax Year 2023 Notice of Proposed Assessment 06/01/2025', key: 'k1' };
    const first = await keepTaxDocument({ institution: ftb, download, state, home: dir, fileDocument, now: new Date('2026-10-04T12:00:00Z') });
    expect(first.status).toBe('imported');
    expect(filed).toEqual([expect.objectContaining({ category: 'tax', periodLabel: '2023', taxYear: 2023, docType: 'notice', institutionKey: 'ftb', source: 'fetch', title: 'Notice of Proposed Assessment' })]);
    expect(first.entry).toMatchObject({ kind: 'tax', documentId: 'doc-1', statementId: null });
    expect(first.entry.path).toContain(join('files', 'ftb', '2023'));
    expect(existsSync(first.entry.path)).toBe(true);

    const again = await keepTaxDocument({ institution: ftb, download, state, home: dir, fileDocument });
    expect(again.status).toBe('duplicate');
    expect(filed).toHaveLength(1);

    const serverHad = await keepTaxDocument({
      institution: ftb, state, home: dir,
      download: { ...download, bytes: PDF('other') },
      fileDocument: async () => ({ document: { id: 'doc-old' }, duplicate: true }),
    });
    expect(serverHad.status).toBe('duplicate');

    const notPdf = await keepTaxDocument({ institution: ftb, state, home: dir, download: { ...download, bytes: Buffer.from('<html>') }, fileDocument });
    expect(notPdf.status).toBe('not_pdf');
  });

  it('records a failed filing for retry instead of losing the file', async () => {
    const dir = home();
    const state = loadLocal(dir);
    const result = await keepTaxDocument({
      institution: pickInstitution([], 'irs'), state, home: dir,
      download: { bytes: PDF('irs'), suggestedName: 'letter.pdf', label: 'Letter', context: 'LTR 0000 2025', key: null },
      fileDocument: async () => { throw new Error('offline'); },
    });
    expect(result.status).toBe('import_failed');
    expect(result.entry).toMatchObject({ importError: 'offline', documentId: null });
  });
});

describe('the attempt throttle', () => {
  const t0 = new Date('2026-10-04T12:00:00Z');
  const plus = (min) => new Date(t0.getTime() + min * 60_000);

  it('allows 2 visits per 30 minutes and 4 per day', () => {
    expect(evaluateThrottle({ attempts: [] }, t0).ok).toBe(true);
    const two = [plus(-10).toISOString(), plus(-5).toISOString()];
    const refused = evaluateThrottle({ attempts: two }, t0);
    expect(refused).toMatchObject({ ok: false, reason: 'window_limit', retryAt: plus(20).toISOString() });
    expect(evaluateThrottle({ attempts: two }, plus(21)).ok).toBe(true);
    const four = [plus(-600), plus(-500), plus(-120), plus(-60)].map((d) => d.toISOString());
    expect(evaluateThrottle({ attempts: four }, t0)).toMatchObject({ ok: false, reason: 'daily_limit', retryAt: plus(-600 + 24 * 60).toISOString() });
  });

  it('refuses everything during a recorded lockout', () => {
    expect(evaluateThrottle({ attempts: [], lockedUntil: plus(35).toISOString(), lockReason: 'lockout page' }, t0)).toMatchObject({ ok: false, reason: 'locked' });
    expect(evaluateThrottle({ attempts: [], lockedUntil: plus(-1).toISOString() }, t0).ok).toBe(true);
  });

  it('recognises lockout pages and how long they last', () => {
    const ftb = 'Account Locked. You have exceeded the allowed number of attempts. Please try again in 30 minutes.';
    expect(detectLockout(ftb)).toEqual({ minutes: 30 });
    expect(lockoutUntil(detectLockout(ftb), t0)).toBe(plus(35).toISOString());
    expect(detectLockout('Too many failed attempts. Try again later.')).toEqual({ minutes: null });
    expect(lockoutUntil({ minutes: null }, t0, TAX_THROTTLE, 35)).toBe(plus(35).toISOString());
    expect(detectLockout('Your account is temporarily locked for 2 hours')).toEqual({ minutes: 120 });
    expect(detectLockout('Notices and letters: 2 new')).toBeNull();
    expect(detectLockout('')).toBeNull();
  });

  it('persists the ledger, counts before the visit, and keeps a lockout', () => {
    const dir = home();
    expect(takeLocalAttempt(dir, 'ftb', 'login', t0).ok).toBe(true);
    expect(takeLocalAttempt(dir, 'ftb', 'fetch', plus(1)).ok).toBe(true);
    expect(takeLocalAttempt(dir, 'ftb', 'fetch', plus(2))).toMatchObject({ ok: false, reason: 'window_limit' });
    expect(loadThrottle(dir).sources.ftb.attempts).toHaveLength(2); // the refusal is not a visit
    expect(takeLocalAttempt(dir, 'irs', 'assist', plus(2)).ok).toBe(true); // per source
    recordLocalLockout(dir, 'irs', plus(40).toISOString(), 'lockout page');
    expect(takeLocalAttempt(dir, 'irs', 'assist', plus(35))).toMatchObject({ ok: false, reason: 'locked' });
    expect(JSON.parse(readFileSync(join(dir, 'throttle.json'), 'utf8')).sources.irs.lockedUntil).toBe(plus(40).toISOString());
  });

  it('treats a corrupt ledger as a refusal, not as no attempts', () => {
    const dir = home();
    writeFileSync(join(dir, 'throttle.json'), '{nope');
    expect(() => takeLocalAttempt(dir, 'ftb', 'fetch', t0)).toThrow(/not valid JSON/);
  });
});

describe('runStatementFetch with tax sources', () => {
  const api = (calls) => ({
    listAccounts: async () => [],
    importStatement: async () => { throw new Error('a tax document is never a statement'); },
    fileDocument: async (opts) => { calls.files.push(opts); return { document: { id: 'd' }, duplicate: false }; },
    reportRun: async (run) => calls.runs.push(run),
  });

  it('works with no linked accounts, and a throttled source never reaches the site', async () => {
    const dir = home();
    mkdirSync(join(profileDir('ftb', dir), 'Default'), { recursive: true });
    const now = new Date();
    takeLocalAttempt(dir, 'ftb', 'login', new Date(now.getTime() - 60_000));
    takeLocalAttempt(dir, 'ftb', 'login', new Date(now.getTime() - 30_000));
    const calls = { files: [], runs: [] };
    const [result] = await runStatementFetch({ api: api(calls), banks: ['ftb'], home: dir, chrome: '/nonexistent/chrome' });
    expect(result).toMatchObject({ bank: 'ftb', kind: 'tax', status: 'throttled' });
    expect(result.message).toMatch(/2 attempts in the last 30 minutes/);
    expect(calls.runs).toEqual([]);
  });

  it('says how to start when nothing is linked or signed in', async () => {
    await expect(runStatementFetch({ api: api({ files: [], runs: [] }), home: home(), chrome: '/nonexistent/chrome' })).rejects.toThrow(/assist irs/);
  });
});

const chrome = findChrome();
describe.skipIf(!chrome || typeof WebSocket === 'undefined')('a whole fetch against a fake tax agency', () => {
  let server;
  let base = '';
  let locked = false;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/notices' && locked) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Account Locked</h1><p>You have exceeded the allowed number of attempts. Try again in 30 minutes.</p>');
      } else if (url.pathname === '/notices') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><body><table>
          <tr><td>06/01/2025</td><td>Notice of Proposed Assessment, Tax Year 2023</td><td><a href="/pdf/npa">View Notice</a></td></tr>
          <tr><td>Tax Year 2024</td><td>Account Transcript</td><td><a href="/pdf/tr">View Transcript</a></td></tr>
          <tr><td><a href="/prefs">Notification preferences</a></td></tr>
        </table></body>`);
      } else if (url.pathname.startsWith('/pdf/')) {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${url.pathname.slice(5)}.pdf"` });
        res.end(PDF(url.pathname));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => server?.close());

  it('files every notice and transcript once, then stops at a lockout and records it', { timeout: 120_000 }, async () => {
    const dir = home();
    const calls = { files: [], runs: [] };
    const fakeApi = {
      listAccounts: async () => [],
      importStatement: async () => { throw new Error('never a statement'); },
      fileDocument: async (opts) => { calls.files.push({ ...opts, file: undefined }); return { document: { id: `d${calls.files.length}` }, duplicate: false }; },
      reportRun: async (run) => calls.runs.push(run),
    };
    mkdirSync(join(profileDir('ftb', dir), 'Default'), { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ institutions: { ftb: { start: `${base}/notices` } } }));
    const options = { api: fakeApi, banks: ['ftb'], home: dir, chrome, renderMs: 4000 };

    const [first] = await runStatementFetch(options);
    expect(first).toMatchObject({ status: 'ok', kind: 'tax', candidates: 2, imported: 2 });
    expect(calls.files).toEqual([
      expect.objectContaining({ category: 'tax', docType: 'notice', taxYear: 2023, institutionKey: 'ftb' }),
      expect.objectContaining({ category: 'tax', docType: 'transcript', taxYear: 2024, periodLabel: '2024' }),
    ]);
    expect(calls.runs[0]).toMatchObject({ institutionKey: 'ftb', status: 'ok', filed: 2 });

    locked = true;
    const [second] = await runStatementFetch(options);
    expect(second).toMatchObject({ status: 'locked' });
    expect(calls.runs[1]).toMatchObject({ status: 'error' });
    expect(Date.parse(loadThrottle(dir).sources.ftb.lockedUntil) - Date.now()).toBeGreaterThan(30 * 60_000);

    // The third run is refused locally: the site sees nothing.
    const before = hits;
    const [third] = await runStatementFetch(options);
    expect(third).toMatchObject({ status: 'throttled' });
    expect(hits).toBe(before);
    rmSync(dir, { recursive: true, force: true });
  });
});
