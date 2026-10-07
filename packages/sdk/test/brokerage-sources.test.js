/**
 * Brokerage sources (Webull): a standalone source with no linked account,
 * the documents collector, and filing statements, trade confirmations and
 * 1099s into the document library. The e2e runs a fake brokerage in a real
 * headless Chrome (skipped without Chrome).
 *
 * No real personal data: account numbers, dates and amounts are made up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  brokerageSource,
  classifyBrokerageDocument,
  findChrome,
  isBrokerageSource,
  isTaxSource,
  keepBrokerageDocument,
  keepCandidate,
  loadLocal,
  pickInstitution,
  profileDir,
  retryImports,
  runStatementFetch,
  saveLocal,
  sourceMode,
  startUrls,
  withStandaloneSources,
} from '../src/statements-fetch.js';

const PDF = (marker) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`, 'latin1');
const home = () => mkdtempSync(join(tmpdir(), 'coinpay-brokerage-'));

describe('webull as a source', () => {
  it('is a brokerage with no linked account, read in documents mode', () => {
    const webull = pickInstitution([], 'webull');
    expect(webull).toMatchObject({ key: 'webull', kind: 'brokerage', accounts: [] });
    expect(isBrokerageSource(webull)).toBe(true);
    expect(isTaxSource(webull)).toBe(false);
    expect(sourceMode(webull)).toBe('documents');
    expect(startUrls(webull)).toEqual({ login: 'https://www.webull.com/edocs', fetch: 'https://www.webull.com/edocs' });
    expect(brokerageSource('webull').name).toBe('Webull');
  });

  it('keeps the bank path when SimpleFIN links a Webull account', () => {
    const linked = [{ key: 'webull', name: 'Webull', url: 'https://webull.com', accounts: [{ id: 'a', name: 'Brokerage (0042)', last4: '0042', institution: 'webull' }] }];
    const merged = withStandaloneSources(linked).filter((i) => i.key === 'webull');
    expect(merged).toHaveLength(1);
    expect(sourceMode(merged[0])).toBe('statements');
  });
});

describe('the documents collector', () => {
  it('keeps statements, confirmations and 1099s, skips settings and undated links', () => {
    expect(keepCandidate('documents', 'Download', 'Monthly Statement September 2026', null)).toBe(true);
    expect(keepCandidate('documents', 'View', 'Trade Confirmation 09/14/2026', null)).toBe(true);
    expect(keepCandidate('documents', '1099 Composite', 'Tax Year 2025 1099 Composite', null)).toBe(true);
    expect(keepCandidate('documents', 'Paperless settings', 'September 2026', null)).toBe(false);
    expect(keepCandidate('documents', 'Statements', 'Statements', null)).toBe(false);
    // A bank page skips the same 1099.
    expect(keepCandidate('statements', '1099 Composite', 'Tax Year 2025 1099 Composite 02/15/2026', null)).toBe(false);
  });
});

describe('classifying a brokerage document', () => {
  const at = new Date('2026-10-07T12:00:00Z');
  it('files a monthly statement by month', () => {
    expect(classifyBrokerageDocument({ label: 'Download', context: 'Monthly Statement 09/01/2026 - 09/30/2026', suggestedName: 'statement.pdf' }, at))
      .toEqual({ category: 'statement', docType: null, taxYear: null, periodLabel: '2026-09', title: 'Monthly Statement 09/01/2026 - 09/30/2026' });
  });
  it('files a trade confirmation by its day', () => {
    expect(classifyBrokerageDocument({ label: 'Trade Confirmation', context: 'Trade Confirmation 09/14/2026', suggestedName: 'confirm.pdf' }, at))
      .toMatchObject({ category: 'statement', periodLabel: '2026-09-14', title: 'Trade Confirmation' });
  });
  it('files a 1099 as a tax form by tax year', () => {
    expect(classifyBrokerageDocument({ label: '1099 Composite', context: 'Tax Year 2025 1099 Composite', suggestedName: '1099.pdf' }, at))
      .toMatchObject({ category: 'tax', docType: 'form', taxYear: 2025, periodLabel: '2025' });
  });
});

describe('filing a brokerage document', () => {
  it('archives it, files it under Documents with its category, keeps one copy, and retries a failure', async () => {
    const dir = home();
    const state = loadLocal(dir);
    const filed = [];
    let fail = true;
    const fileDocument = async (opts) => {
      if (fail) throw new Error('offline');
      filed.push({ ...opts, file: undefined });
      return { document: { id: `doc-${filed.length}` }, duplicate: false };
    };
    const webull = pickInstitution([], 'webull');
    const download = { bytes: PDF('stmt'), suggestedName: 'statement.pdf', label: 'Download', context: 'Monthly Statement September 2026', key: 'k1' };
    const first = await keepBrokerageDocument({ institution: webull, download, state, home: dir, fileDocument, now: new Date('2026-10-07T12:00:00Z') });
    expect(first.status).toBe('import_failed');
    expect(first.entry).toMatchObject({ kind: 'brokerage', category: 'statement', periodLabel: '2026-09' });
    expect(first.entry.path).toContain(join('files', 'webull', '2026'));
    expect(existsSync(first.entry.path)).toBe(true);
    saveLocal(state, dir);

    fail = false;
    const api = { listAccounts: async () => [], fileDocument };
    expect(await retryImports({ api, home: dir })).toEqual({ imported: 1, skipped: 0, failed: 0 });
    expect(filed).toEqual([expect.objectContaining({ category: 'statement', periodLabel: '2026-09', institutionKey: 'webull', source: 'fetch' })]);

    const again = await keepBrokerageDocument({ institution: webull, download, state: loadLocal(dir), home: dir, fileDocument });
    expect(again.status).toBe('duplicate');
  });
});

const chrome = findChrome();
describe.skipIf(!chrome || typeof WebSocket === 'undefined')('a whole fetch against a fake brokerage', () => {
  let server;
  let base = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/edocs') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><body><table>
          <tr><td>Monthly Statement</td><td>09/01/2026 - 09/30/2026</td><td><a href="/pdf/stmt-2026-09">Download</a></td></tr>
          <tr><td>Trade Confirmation</td><td>09/14/2026</td><td><a href="/pdf/confirm-0914">Download</a></td></tr>
          <tr><td>Tax Year 2025</td><td>1099 Composite</td><td><a href="/pdf/1099-2025">Download</a></td></tr>
          <tr><td><a href="/prefs">Paperless settings</a></td></tr>
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

  it('files every statement, confirmation and 1099 once', { timeout: 120_000 }, async () => {
    const dir = home();
    const calls = { files: [], runs: [] };
    const fakeApi = {
      listAccounts: async () => [],
      importStatement: async () => { throw new Error('never a statement import'); },
      fileDocument: async (opts) => { calls.files.push({ ...opts, file: undefined }); return { document: { id: `d${calls.files.length}` }, duplicate: false }; },
      reportRun: async (run) => calls.runs.push(run),
    };
    mkdirSync(join(profileDir('webull', dir), 'Default'), { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ institutions: { webull: { start: `${base}/edocs` } } }));
    const options = { api: fakeApi, banks: ['webull'], home: dir, chrome, renderMs: 4000 };

    const [first] = await runStatementFetch(options);
    expect(first).toMatchObject({ status: 'ok', kind: 'brokerage', candidates: 3, imported: 3 });
    expect(calls.files).toEqual([
      expect.objectContaining({ category: 'statement', periodLabel: '2026-09', institutionKey: 'webull' }),
      expect.objectContaining({ category: 'statement', periodLabel: '2026-09-14' }),
      expect.objectContaining({ category: 'tax', docType: 'form', taxYear: 2025 }),
    ]);
    expect(calls.runs[0]).toMatchObject({ institutionKey: 'webull', status: 'ok', filed: 3 });

    const [second] = await runStatementFetch(options);
    expect(second).toMatchObject({ status: 'ok', imported: 0 });
    expect(calls.files).toHaveLength(3);
  });
});
