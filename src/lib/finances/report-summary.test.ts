import { describe, it, expect } from 'vitest';
import { summarizeCurrency, summarizeDataset, formatMoney, sourceKey } from './report-summary';
import { estimateLeadingGap } from './estimates';
import { summarySvgs, compactMoney, SvgCanvas, drawMonthlyFlows } from './charts';
import type { ReportAccount, ReportRow } from './render';

const TZ = 'America/Los_Angeles';

function account(over: Partial<ReportAccount> = {}): ReportAccount {
  return {
    id: 'a1', name: 'Checking', orgName: 'Bank', currency: 'USD', kind: 'checking', scope: 'business', isHidden: false, identityState: 'ok',
    currentBalance: '1200', currentBalanceAsOf: '2026-09-12T10:00:00.000Z', availableBalance: null,
    openingBalance: null, closingBalance: null, balanceProvenance: 'unavailable',
    ...over,
  };
}

function row(id: string, posted: string, amount: string, over: Partial<ReportRow> = {}): ReportRow {
  return { id, accountId: 'a1', externalId: id, posted, transactedAt: null, amount, description: null, payee: null, memo: null, mcc: null, category: null, revision: 1, ...over };
}

const ACCOUNTS = [account(), account({ id: 'card', name: 'Visa', kind: 'credit', currentBalance: '-350.25' }), account({ id: 'eur', name: 'Euro', currency: 'EUR', currentBalance: '10' })];

const ROWS: ReportRow[] = [
  row('t1', '2026-03-02T12:00:00.000Z', '3000', { payee: 'ACME Corp', category: 'income' }),
  row('t2', '2026-03-05T12:00:00.000Z', '-500', { category: 'transfer' }), // to savings: not spending
  row('t3', '2026-03-09T12:00:00.000Z', '-120.5', { category: 'software', payee: 'GitHub' }),
  row('t4', '2026-04-01T12:00:00.000Z', '-80', { category: 'dining' }),
  row('t5', '2026-04-15T12:00:00.000Z', '1000', { payee: 'ACME Corp #4412', category: 'income' }),
  row('t6', '2026-04-20T12:00:00.000Z', '-600', { accountId: 'card', category: 'payment' }), // card payment: internal
  row('t7', '2026-04-22T12:00:00.000Z', '-45', { accountId: 'card', category: 'dining' }),
  row('t8', '2026-04-23T12:00:00.000Z', '0', { category: 'other' }),
];

describe('summarizeCurrency', () => {
  const base = { currency: 'USD', timezone: TZ, start: '2026-03-01T08:00:00.000Z', end: '2026-05-01T07:00:00.000Z', accounts: ACCOUNTS, posted: ROWS, estimate: null };

  it('separates money in and out from transfers and card payments, per calendar month', () => {
    const s = summarizeCurrency(base);
    expect(s.days).toBe(61);
    expect(s.months.map((m) => m.month)).toEqual(['2026-03', '2026-04']);
    expect(s.income).toBe('4000');
    expect(s.spending).toBe('245.5');
    expect(s.net).toBe('3754.5');
    expect(s.transfersOut).toBe('1100');
    expect(s.credits).toBe('4000');
    expect(s.debits).toBe('1345.5');
    const march = s.months[0];
    expect(march.income).toBe('3000');
    expect(march.spending).toBe('120.5');
    expect(march.transfersOut).toBe('500');
    expect(march.days).toBe(31);
    expect(march.estimatedDays).toBe(0);
    const april = s.months[1];
    expect(april.spending).toBe('125');
    expect(april.cumulativeNet).toBe('3754.5');
    expect(s.monthsSpendingExceededIncome).toBe(0);
    expect(s.rows).toBe(8);
  });

  it('ranks spending by category and income by a cleaned source name', () => {
    const s = summarizeCurrency(base);
    expect(s.spendingByCategory.map((l) => [l.label, l.total])).toEqual([
      ['Dining', '125'],
      ['Software', '120.5'],
    ]);
    expect(s.spendingByCategory[0].share).toBeCloseTo(125 / 245.5, 3);
    // "ACME Corp" and "ACME Corp #4412" are one source.
    expect(s.incomeBySource).toHaveLength(1);
    expect(s.incomeBySource[0]).toMatchObject({ label: 'ACME Corp', total: '4000', rows: 2 });
  });

  it('reads balances: cash on hand from bank accounts, owed from a negative card balance', () => {
    const s = summarizeCurrency(base);
    expect(s.cashOnHand).toBe('1200');
    expect(s.owed).toBe('350.25');
    expect(s.balances.map((b) => b.name)).toEqual(['Checking', 'Visa']);
    expect(s.balancesAsOf).toBe('2026-09-12T10:00:00.000Z');
  });

  it('applies the daily-mean estimate to money in and out and marks the months it touches', () => {
    const estimate = estimateLeadingGap({ currency: 'USD', start: '2026-01-01T08:00:00.000Z', end: '2026-05-01T07:00:00.000Z', timezone: TZ, firstPosted: '2026-03-02T12:00:00.000Z', observedCredits: '4000', observedDebits: '1345.5' });
    expect(estimate?.missingDays).toBe(60);
    const s = summarizeCurrency({ ...base, start: '2026-01-01T08:00:00.000Z', estimate });
    expect(s.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(s.months[0].estimatedDays).toBe(31);
    expect(s.months[1].estimatedDays).toBe(28);
    expect(s.months[2].estimatedDays).toBe(1);
    expect(s.months[2].observedDays).toBe(30);
    expect(s.months[3].estimatedDays).toBe(0);
    expect(s.estimatedDays).toBe(60);
    expect(s.observedDays).toBe(60);
    // 4000 / 60 observed days = 66.6667 a day; × 60 missing days.
    expect(s.estimate?.income).toBe('4000.002');
    expect(s.months[0].estimatedIncome).toBe('2066.6677');
    expect(s.months[3].estimatedIncome).toBeNull();
    expect(s.incomeWithEstimate).toBe('8000.002');
    // Observed totals are untouched.
    expect(s.income).toBe('4000');
    expect(s.highlights.some((h) => h.includes('estimate for 2026-01-01 to 2026-03-01'))).toBe(true);
  });

  it('writes highlights a non-specialist can read', () => {
    const s = summarizeCurrency(base);
    expect(s.highlights[0]).toContain('money coming in from outside these accounts came to $4,000.00');
    expect(s.highlights[0]).toContain('$3,754.50 more came in than went out');
    expect(s.highlights.some((h) => h.startsWith('Balances as of 2026-09-12: $1,200.00 in 1 bank account(s), $350.25 owed on cards and loans'))).toBe(true);
    expect(s.highlights.some((h) => h.includes('Transfers between the owner'))).toBe(true);
  });

  it('handles an empty period without dividing by zero', () => {
    const s = summarizeCurrency({ ...base, posted: [] });
    expect(s.income).toBe('0');
    expect(s.monthlyMeanIncome).toBe('0');
    expect(s.months).toHaveLength(2);
    expect(s.spendingByCategory).toEqual([]);
  });
});

describe('summarizeDataset', () => {
  it('produces one summary per currency and never mixes them', () => {
    const all = summarizeDataset({ timezone: TZ, start: '2026-03-01T08:00:00.000Z', end: '2026-05-01T07:00:00.000Z', accounts: ACCOUNTS, posted: ROWS, estimates: [] });
    expect(all.map((s) => s.currency)).toEqual(['EUR', 'USD']);
    expect(all[0].rows).toBe(0);
    expect(all[0].cashOnHand).toBe('10');
    expect(all[1].rows).toBe(8);
  });
});

describe('formatting helpers', () => {
  it('groups thousands and keeps the sign', () => {
    expect(formatMoney('1234567.891', 'USD')).toBe('$1,234,567.89');
    expect(formatMoney('-42', 'EUR')).toBe('-€42.00');
    expect(formatMoney('5', 'XYZ')).toBe('XYZ 5.00');
    expect(compactMoney(1234, 'USD')).toBe('$1.2k');
    expect(compactMoney(-25000, 'USD')).toBe('-$25k');
    expect(compactMoney(0, 'USD')).toBe('$0');
  });

  it('strips reference numbers from a source name', () => {
    expect(sourceKey({ payee: 'Stripe Payout #2024-11', description: null })).toEqual({ key: 'stripe payout', label: 'Stripe Payout' });
    expect(sourceKey({ payee: null, description: 'ZELLE FROM JANE DOE 123456' })).toEqual({ key: 'zelle from jane', label: 'ZELLE FROM JANE' });
    expect(sourceKey({ payee: null, description: null }).label).toBe('Unknown source');
  });
});

describe('charts', () => {
  it('renders every chart as inline SVG with a legend and escaped text', () => {
    const s = summarizeCurrency({ currency: 'USD', timezone: TZ, start: '2026-03-01T08:00:00.000Z', end: '2026-05-01T07:00:00.000Z', accounts: [account({ name: 'A<b>&"c"' })], posted: ROWS.filter((r) => r.accountId === 'a1'), estimate: null });
    const svgs = summarySvgs(s);
    for (const svg of Object.values(svgs)) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toMatch(/<script/i);
    }
    expect(svgs.monthly).toContain('Money in');
    expect(svgs.monthly).toContain('Money out');
    expect(svgs.cumulative).toContain('Cumulative net');
    expect(svgs.balances).toContain('A&lt;b&gt;&amp;&quot;c&quot;');
    expect(svgs.balances).not.toContain('A<b>');
  });

  it('marks estimated months in text, not only in colour', () => {
    const estimate = estimateLeadingGap({ currency: 'USD', start: '2026-01-01T08:00:00.000Z', end: '2026-05-01T07:00:00.000Z', timezone: TZ, firstPosted: '2026-03-02T12:00:00.000Z', observedCredits: '4000', observedDebits: '1345.5' });
    const s = summarizeCurrency({ currency: 'USD', timezone: TZ, start: '2026-01-01T08:00:00.000Z', end: '2026-05-01T07:00:00.000Z', accounts: ACCOUNTS, posted: ROWS, estimate });
    const cv = new SvgCanvas(520, 200);
    drawMonthlyFlows(cv, { x: 8, y: 6, w: 504, h: 188 }, s.months, 'USD');
    const svg = cv.toString();
    expect(svg).toContain('>est.<');
    expect(svg).toContain('>part est.<');
    expect(svg).toContain('Estimated (lighter, marked est.)');
  });
});
