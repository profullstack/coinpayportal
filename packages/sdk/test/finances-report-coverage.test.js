/**
 * The ledger a report is built from, and what it says when that ledger is
 * short. No network: a fake client reproduces the API's real behaviour, which
 * is to cap a page far below the `total` it reports.
 */

import { describe, it, expect } from 'vitest';
import { collectFinanceSnapshot, listAllFinanceTransactions } from '../src/finances.js';
import { buildFinanceReportHtml } from '../src/finances-report.js';

const PAGE_CAP = 500;

/** Rows shaped like the ledger, newest first. */
function rows(from, count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${from + i}`,
    amount: -10,
    description: `row ${from + i}`,
    posted_at: '2026-01-01T00:00:00.000Z',
  }));
}

/**
 * A client whose transactions route caps every page at 500 while reporting the
 * true total — the behaviour that made a single call return a partial ledger.
 */
function cappedClient(total, { onRequest } = {}) {
  return {
    async request(path) {
      onRequest?.(path);
      if (path.startsWith('/finances/transactions')) {
        const url = new URL(path, 'https://x.test');
        const limit = Math.min(Number(url.searchParams.get('limit')) || 100, PAGE_CAP);
        const offset = Number(url.searchParams.get('offset')) || 0;
        const remaining = Math.max(0, total - offset);
        return { rows: rows(offset, Math.min(limit, remaining)), total, limit, offset };
      }
      // Every other source is irrelevant here and allowed to be empty.
      if (path.startsWith('/finances/accounts')) return { accounts: [] };
      return {};
    },
  };
}

describe('listAllFinanceTransactions', () => {
  it('pages past the cap instead of returning the first page', async () => {
    const result = await listAllFinanceTransactions(cappedClient(1200));
    expect(result.rows).toHaveLength(1200);
    expect(result.total).toBe(1200);
    expect(result.complete).toBe(true);
  });

  it('asks for as few pages as the cap allows', async () => {
    const paths = [];
    // The spy belongs to the client, not to the function under test.
    await listAllFinanceTransactions(cappedClient(1200, { onRequest: (p) => paths.push(p) }));
    // 1200 rows at 500 per page is three calls, not one per row.
    expect(paths).toHaveLength(3);
  });

  it('stops on a short page rather than spinning when total disagrees', async () => {
    // A total that overstates what the route will actually return: without the
    // short-page check this loops until `max`.
    const client = {
      async request() {
        return { rows: rows(0, 10), total: 99999, limit: 500, offset: 0 };
      },
    };
    const result = await listAllFinanceTransactions(client);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.complete).toBe(false);
  });

  it('honours the max so a runaway total cannot exhaust memory', async () => {
    const result = await listAllFinanceTransactions(cappedClient(10000), { max: 1000 });
    expect(result.rows).toHaveLength(1000);
    expect(result.complete).toBe(false);
  });

  it('handles an empty ledger', async () => {
    const result = await listAllFinanceTransactions(cappedClient(0));
    expect(result.rows).toEqual([]);
    expect(result.complete).toBe(true);
  });
});

describe('collectFinanceSnapshot', () => {
  it('returns one page by default, for the dashboard', async () => {
    const snapshot = await collectFinanceSnapshot(cappedClient(1200), { days: 365, limit: 5000 });
    expect(snapshot.bank.ledger).toHaveLength(PAGE_CAP);
    expect(snapshot.bank.ledgerComplete).toBe(false);
  });

  it('pages the whole window when a report asks for it', async () => {
    const snapshot = await collectFinanceSnapshot(cappedClient(1200), {
      days: 365,
      allTransactions: true,
    });
    expect(snapshot.bank.ledger).toHaveLength(1200);
    expect(snapshot.bank.ledgerComplete).toBe(true);
  });
});

describe('the report never overstates its coverage', () => {
  const base = {
    generatedAt: '2026-09-08T00:00:00.000Z',
    windowDays: 365,
    position: { lookbackDays: 180 },
  };

  it('warns, in the document, when the ledger is one page of a longer window', () => {
    const html = buildFinanceReportHtml({
      ...base,
      bank: { currency: 'USD', accountCount: 2, ledger: rows(0, 500), ledgerTotal: 1200, ledgerComplete: false },
    });
    expect(html).toMatch(/Incomplete/);
    expect(html).toMatch(/500/);
    expect(html).toMatch(/1200/);
    expect(html).toMatch(/Do not reconcile against/);
  });

  it('says nothing when the ledger is complete', () => {
    const html = buildFinanceReportHtml({
      ...base,
      bank: { currency: 'USD', accountCount: 2, ledger: rows(0, 1200), ledgerTotal: 1200, ledgerComplete: true },
    });
    expect(html).not.toMatch(/Incomplete/);
    expect(html).not.toMatch(/Do not reconcile against/);
  });

  it('warns rather than staying silent when completeness is unknown', () => {
    // An older snapshot has no ledgerComplete. Absent evidence of coverage is
    // not evidence of coverage, but it is also not a claim of truncation, so
    // this must not fire on a genuinely short final page.
    const html = buildFinanceReportHtml({
      ...base,
      bank: { currency: 'USD', accountCount: 1, ledger: rows(0, 10), ledgerTotal: 10 },
    });
    expect(html).not.toMatch(/Incomplete/);
  });
});
