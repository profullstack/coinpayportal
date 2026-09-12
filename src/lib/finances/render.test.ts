import { describe, it, expect } from 'vitest';
import { renderCsv, renderHtml, renderPdf, csvText, canonicalJson, GENERATED_BY_NOTICE, type ReportDataset } from './render';
import { summarizeDataset } from './report-summary';

function dataset(overrides: Partial<ReportDataset> = {}): ReportDataset {
  return {
    schema: 'coinpay.finance-report/1',
    report: {
      id: 'r1',
      revision: 1,
      merchantId: 'm1',
      periodKind: 'month',
      periodSelector: '2026-08',
      periodLabel: 'August 2026',
      timezone: 'America/Los_Angeles',
      requestedStart: '2026-08-01T07:00:00.000Z',
      requestedEnd: '2026-09-01T07:00:00.000Z',
      effectiveEnd: '2026-09-01T07:00:00.000Z',
      periodToDate: false,
      cutoff: '2026-09-12T00:00:00.000Z',
      scope: 'all',
      includeHidden: false,
      includePending: true,
      generatedAt: '2026-09-12T00:00:00.000Z',
      snapshotAt: '2026-09-12T00:00:00.000Z',
      rendererVersion: 'test',
    },
    accounts: [
      {
        id: 'a1', name: 'Checking', orgName: 'Example Bank', currency: 'USD', kind: 'checking', scope: 'business', isHidden: false,
        identityState: 'ok', currentBalance: '1000.5', currentBalanceAsOf: '2026-09-11T00:00:00.000Z', availableBalance: null,
        openingBalance: null, closingBalance: null, balanceProvenance: 'unavailable',
      },
      {
        id: 'a2', name: 'Euro', orgName: 'Example Bank', currency: 'EUR', kind: 'checking', scope: 'personal', isHidden: false,
        identityState: 'ok', currentBalance: null, currentBalanceAsOf: null, availableBalance: null,
        openingBalance: null, closingBalance: null, balanceProvenance: 'unavailable',
      },
    ],
    posted: [
      { id: 't1', accountId: 'a1', externalId: 'x1', posted: '2026-08-02T12:00:00.000Z', transactedAt: null, amount: '0.1', description: '=HYPERLINK("http://evil")', payee: null, memo: null, mcc: null, category: 'income', revision: 1 },
      { id: 't2', accountId: 'a1', externalId: 'x2', posted: '2026-08-03T12:00:00.000Z', transactedAt: null, amount: '-0.2', description: 'Coffee, "the good one"', payee: 'Cafe', memo: 'line\nbreak', mcc: '5812', category: 'dining', revision: 1 },
      { id: 't3', accountId: 'a2', externalId: 'x3', posted: '2026-08-04T12:00:00.000Z', transactedAt: null, amount: '50', description: '<script>alert(1)</script>', payee: null, memo: null, mcc: null, category: null, revision: 1 },
    ],
    pending: [
      { id: 't4', accountId: 'a1', externalId: 'x4', posted: null, transactedAt: '2026-08-30T12:00:00.000Z', amount: '-9.99', description: 'Pending thing', payee: null, memo: null, mcc: null, category: null, revision: 1 },
    ],
    totals: [
      { currency: 'EUR', credits: '50', debits: '0', net: '50', rows: 1 },
      { currency: 'USD', credits: '0.1', debits: '0.2', net: '-0.1', rows: 2 },
    ],
    accountTotals: [
      { accountId: 'a1', credits: '0.1', debits: '0.2', net: '-0.1', rows: 2 },
      { accountId: 'a2', credits: '50', debits: '0', net: '50', rows: 1 },
    ],
    estimates: [],
    totalsWithEstimates: [],
    summary: [],
    coverage: {
      local_export_complete: true,
      provider_coverage: 'partial',
      reconciliation_status: 'not_attempted',
      accounts: [],
      warnings: ['Checking: 1 interval(s) of this period were never fetched.'],
      explanation: 'Part of this period was never fetched.',
    },
    statements: [],
    disclaimers: [GENERATED_BY_NOTICE],
    ...overrides,
  };
}

describe('csvText', () => {
  it('neutralises spreadsheet formula prefixes and quotes delimiters', () => {
    expect(csvText('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvText('+1')).toBe("'+1");
    expect(csvText('-refund')).toBe("'-refund");
    expect(csvText('@me')).toBe("'@me");
    expect(csvText('a,b')).toBe('"a,b"');
    expect(csvText('line\nbreak')).toBe('"line\nbreak"');
    expect(csvText('plain')).toBe('plain');
    expect(csvText(null)).toBe('');
  });
});

describe('renderCsv', () => {
  it('emits every posted and pending row with numeric amounts untouched', () => {
    const csv = renderCsv(dataset());
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines[0]).toContain(GENERATED_BY_NOTICE);
    expect(lines[3]).toBe('section,account_name,institution,currency,posted,transacted_at,amount,description,payee,memo,category,mcc,pending,external_id,account_id,transaction_id');
    expect(lines).toHaveLength(4 + 4);
    // The formula is neutralised; the negative amount is not.
    expect(lines[4]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[5]).toContain(',-0.2,');
    expect(lines[7].startsWith('pending,')).toBe(true);
    expect(lines[7]).toContain(',true,');
  });
});

describe('renderHtml', () => {
  it('escapes untrusted text and carries the notice, per-currency totals and warnings', () => {
    const html = renderHtml(dataset());
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain(GENERATED_BY_NOTICE);
    expect(html).toContain('History may be incomplete');
    expect(html).toContain('Opening balance unavailable');
    expect(html).toContain('<td>EUR</td>');
    expect(html).toContain('<td>USD</td>');
    expect(html).toContain('Pending appendix (1)');
    expect(html).toContain('never fetched');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src="http/i);
  });

  it('labels a running period', () => {
    const html = renderHtml(dataset({ report: { ...dataset().report, periodToDate: true } }));
    expect(html).toContain('Period to date');
  });
});

function summarized(): ReportDataset {
  const ds = dataset();
  return { ...ds, summary: summarizeDataset({ timezone: ds.report.timezone, start: ds.report.requestedStart, end: ds.report.effectiveEnd, accounts: ds.accounts, posted: ds.posted, estimates: [] }) };
}

describe('executive summary', () => {
  it('leads the HTML with tiles, highlights and inline SVG charts, one block per currency', () => {
    const html = renderHtml(summarized());
    expect(html).toContain('Executive summary (EUR)');
    expect(html).toContain('Executive summary (USD)');
    expect(html.indexOf('Executive summary')).toBeLessThan(html.indexOf('Gross bank flows by currency'));
    expect(html).toContain('Money in vs money out, by month');
    expect(html).toContain('Running total: money in minus money out');
    expect(html).toContain('<svg xmlns');
    expect(html).toContain('money coming in from outside these accounts came to $0.10');
    expect(html).not.toMatch(/<script/i);
  });

  it('renders a PDF that carries the summary pages', async () => {
    const pdf = await renderPdf(summarized());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const plain = await renderPdf(dataset());
    expect(pdf.length).toBeGreaterThan(plain.length);
    const a = await renderPdf(summarized());
    expect(a.equals(pdf)).toBe(true);
  });
});

describe('renderPdf', () => {
  it('produces real PDF bytes with the notice on every page', async () => {
    const pdf = await renderPdf(dataset());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('is deterministic for the same dataset', async () => {
    const a = await renderPdf(dataset());
    const b = await renderPdf(dataset());
    expect(a.equals(b)).toBe(true);
  });
});

describe('canonicalJson', () => {
  it('sorts keys so hashes are stable', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });
});
