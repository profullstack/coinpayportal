import { describe, it, expect } from 'vitest';
import { buildPnl, lastCompleteMonths, monthsBetween, pairTransfers, renderPnlCsv, renderPnlHtml, type PnlAccount, type PnlRow } from './pnl';

const TZ = 'America/Los_Angeles';
const START = '2026-07-01T07:00:00.000Z';
const END = '2026-10-01T07:00:00.000Z';

const ACCOUNTS: PnlAccount[] = [
  { id: 'chk', name: 'Free Checking', orgName: 'DCU', kind: 'checking', liability: false, scope: 'personal', hidden: false, currency: 'USD' },
  { id: 'sav', name: 'Savings', orgName: 'DCU', kind: 'savings', liability: false, scope: 'personal', hidden: false, currency: 'USD' },
  { id: 'card', name: 'Visa', orgName: 'Chase', kind: 'credit', liability: true, scope: 'personal', hidden: false, currency: 'USD' },
  { id: 'kid', name: 'Kid Savings', orgName: 'Bay', kind: 'savings', liability: false, scope: 'personal', hidden: false, currency: 'USD' },
  { id: 'biz', name: 'Business Checking', orgName: 'DCU', kind: 'checking', liability: false, scope: 'business', hidden: false, currency: 'USD' },
  { id: 'bizcard', name: 'Amex', orgName: 'Amex', kind: 'credit', liability: true, scope: 'business', hidden: false, currency: 'USD' },
];

let n = 0;
function row(accountId: string, day: string, amount: string, description: string, over: Partial<PnlRow> = {}): PnlRow {
  n += 1;
  const scope = ACCOUNTS.find((a) => a.id === accountId)!.scope;
  return { id: `t${String(n).padStart(3, '0')}`, accountId, posted: `${day}T00:00:00.000Z`, amount, description, payee: null, category: null, taxCategory: null, reviewed: false, scope, ...over };
}

function build(rows: PnlRow[], scope: 'personal' | 'business' = 'personal', receipts = []) {
  return buildPnl({ scope, holder: 'Pat Example', start: START, end: END, timezone: TZ, rows, accounts: ACCOUNTS, receipts, now: new Date('2026-10-21T12:00:00Z') });
}

function line(s: ReturnType<typeof build>, key: string) {
  return [...s.income, ...s.expenses, ...s.excluded].find((l) => l.key === key);
}

describe('buildPnl', () => {
  it('counts a retirement custodian deposit as income even when auto-categorised as a transfer', () => {
    const s = build([row('chk', '2026-07-01', '3328.24', 'ELECTRONIC DEPOSIT - ITC2.0 OUTBOUND ACH ANTHONY ETTINGER', { category: 'transfer' })]);
    expect(line(s, 'retirement')?.total).toBe('3328.24');
    expect(s.totals.earned).toBe('0');
    expect(s.totals.income).toBe('3328.24');
  });

  it('counts a T. Rowe Price "UST MONEY TRAN" deposit as a retirement withdrawal', () => {
    const s = build([row('chk', '2026-09-10', '15508.36', 'ELECTRONIC DEPOSIT - 000053UST MONEY TRAN000053 ANTHONY ETTINGER')]);
    expect(line(s, 'retirement')?.total).toBe('15508.36');
    expect(line(s, 'unidentified')).toBeUndefined();
    expect(s.itemized.map((r) => r.amount)).toEqual(['15508.36']);
  });

  it('counts a deposit with no stated source as income and itemizes it', () => {
    const s = build([row('chk', '2026-09-10', '1200.15', 'ELECTRONIC DEPOSIT - ACME HOLDINGS')]);
    expect(line(s, 'unidentified')?.total).toBe('1200.15');
    expect(s.itemized.map((r) => r.amount)).toEqual(['1200.15']);
  });

  it('never counts a credit on a card as income', () => {
    const s = build([
      row('card', '2026-07-30', '824.63', 'Payment Thank You-Mobile'),
      row('card', '2026-09-21', '197.57', 'STATEMENT CREDIT'),
      row('card', '2026-08-01', '-50', 'GROCER', { category: 'groceries' }),
    ]);
    expect(s.totals.income).toBe('0');
    expect(line(s, 'card_payments')?.total).toBe('824.63');
    expect(line(s, 'refunds')?.total).toBe('197.57');
    expect(s.totals.expenses).toBe('50');
  });

  it('pairs a move between own accounts and excludes both legs', () => {
    const s = build([
      row('sav', '2026-07-13', '-800', 'Digital Federal Credit Union'),
      row('chk', '2026-07-14', '800', 'ELECTRONIC DEPOSIT - TECH CU ACH TRANSF'),
    ]);
    expect(s.totals.income).toBe('0');
    expect(s.totals.expenses).toBe('0');
    expect(line(s, 'own_transfers')?.rows).toBe(2);
  });

  it('does not pair a round amount without transfer text on both legs', () => {
    const rows = [
      row('chk', '2026-08-04', '-100', 'ELECTRONIC WITHDRAWAL GREENLIGHT APP'),
      row('kid', '2026-08-05', '100', 'Deposit INTERNET TRANSFER FROM / : XXXX1943'),
    ];
    const pairs = pairTransfers(rows, new Map(ACCOUNTS.map((a) => [a.id, a])));
    expect(pairs.size).toBe(0);
  });

  it('pairs an amount with cents on the amount alone', () => {
    const rows = [row('chk', '2026-08-04', '-606.63', 'CHASE CREDIT CRD EPAY'), row('card', '2026-08-05', '606.63', 'Payment Thank You-Mobile')];
    expect(pairTransfers(rows, new Map(ACCOUNTS.map((a) => [a.id, a]))).size).toBe(2);
  });

  it('reads personal-to-business moves as an owner contribution, not business income', () => {
    const rows = [
      row('chk', '2026-08-26', '-2500', 'TRANSFER TO MBR ***3444 ONE TIME TRANSFER TO BUSINESS CHECKING'),
      row('biz', '2026-08-26', '2500', 'TRANSFER FROM ACCT ***6266-002 ONE TIME TRANSFER TO BUSINESS CHECKING'),
      row('biz', '2026-08-27', '15.29', 'STRIPE TRANSFER'),
    ];
    const biz = build(rows, 'business');
    expect(line(biz, 'owner_in')?.total).toBe('2500');
    expect(biz.totals.income).toBe('15.29');
    const personal = build(rows, 'personal');
    expect(line(personal, 'to_business')?.total).toBe('2500');
    expect(personal.totals.expenses).toBe('0');
  });

  it('adds CoinPay receipts to business income only', () => {
    const receipts = [{ id: 'p1', created: '2026-08-02T18:00:00.000Z', amount: '20.00', currency: 'USD', business: 'smshub.dev', status: 'forwarded' }];
    expect(build([], 'business', receipts as never).totals.earned).toBe('20');
    expect(build([], 'personal', receipts as never).totals.income).toBe('0');
  });

  it('treats a returned card payment as a payment reversal, not a purchase', () => {
    const s = build([row('bizcard', '2026-09-24', '-1132.9', 'RETURNED CHECK/DECLIANK TRANSAC')], 'business');
    expect(s.totals.expenses).toBe('0');
    expect(line(s, 'card_payments')?.total).toBe('1132.9');
  });

  it('honours a row confirmed as a transfer in Books', () => {
    const s = build([row('chk', '2026-09-10', '6984.86', 'UST MONEY TRAN', { reviewed: true, taxCategory: 'transfer' })]);
    expect(s.totals.income).toBe('0');
  });

  it('buckets a bank row by its posted calendar day, not the local instant', () => {
    const s = build([row('chk', '2026-09-01', '0.12', 'DIVIDEND', { category: 'income' }), row('chk', '2026-10-01', '9', 'DIVIDEND')]);
    expect(line(s, 'interest')?.months).toEqual({ '2026-07': '0', '2026-08': '0', '2026-09': '0.12' });
    expect(s.itemized).toHaveLength(0);
  });

  it('averages per month exactly', () => {
    const s = build([row('chk', '2026-07-02', '100.01', 'PAYROLL ACME')]);
    expect(s.totals.monthlyIncome).toBe('33.3367');
    expect(s.totals.earned).toBe('100.01');
  });

  it('renders the holder, period and every income item', () => {
    const s = build([row('chk', '2026-07-28', '9798.77', 'ELECTRONIC DEPOSIT - EMPOWER')]);
    const html = renderPnlHtml(s);
    expect(html).toContain('Personal Profit and Loss Statement');
    expect(html).toContain('July 1, 2026 through September 30, 2026');
    expect(html).toContain('9,798.77');
    expect(renderPnlCsv(s)).toContain('Retirement account withdrawals (one-time)');
  });
});

describe('periods', () => {
  it('picks the last complete calendar months in the timezone', () => {
    expect(lastCompleteMonths(3, new Date('2026-10-21T12:00:00Z'), TZ)).toEqual({ from: '2026-07-01', to: '2026-10-01' });
    expect(lastCompleteMonths(3, new Date('2026-02-01T05:00:00Z'), TZ)).toEqual({ from: '2025-10-01', to: '2026-01-01' });
  });

  it('labels partial months', () => {
    expect(monthsBetween(START, '2026-08-15T07:00:00.000Z', TZ).map((m) => m.label)).toEqual(['July 2026', 'August 2026 (part)']);
  });
});
