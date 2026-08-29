import { describe, it, expect } from 'vitest';
import { reconcileSettlements, type ExpectedSettlement } from './reconcile';
import type { BankTransaction } from './types';

function credit(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    providerTransactionId: 'txn-1',
    providerAccountId: 'acct-1',
    amountMinor: 50_000,
    currency: 'USD',
    date: '2026-08-20',
    description: 'CoinPay payout',
    counterparty: null,
    pending: false,
    category: null,
    ...overrides,
  };
}

function settlement(overrides: Partial<ExpectedSettlement> = {}): ExpectedSettlement {
  return { id: 'po_1', amountMinor: 50_000, currency: 'USD', date: '2026-08-18', ...overrides };
}

describe('reconcileSettlements', () => {
  it('matches a credit that lands within the window', () => {
    const result = reconcileSettlements([settlement()], [credit()]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].dayGap).toBe(2);
    expect(result.matched[0].ambiguous).toBe(false);
    expect(result.unmatchedSettlements).toHaveLength(0);
    expect(result.unmatchedCredits).toHaveLength(0);
  });

  it('reports a settlement with no matching credit rather than forcing a pairing', () => {
    const result = reconcileSettlements([settlement()], [credit({ amountMinor: 49_999 })]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSettlements.map((s) => s.id)).toEqual(['po_1']);
    // The near-miss credit is still surfaced so a human can spot the discrepancy.
    expect(result.unmatchedCredits).toHaveLength(1);
  });

  it('ignores debits — only money arriving can settle a payout', () => {
    const result = reconcileSettlements([settlement()], [credit({ amountMinor: -50_000 })]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSettlements).toHaveLength(1);
  });

  it('ignores pending rows, whose id and amount can still change', () => {
    const result = reconcileSettlements([settlement()], [credit({ pending: true })]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedCredits).toHaveLength(0);
  });

  it('never matches a credit that posted before the settlement date', () => {
    const result = reconcileSettlements(
      [settlement({ date: '2026-08-18' })],
      [credit({ date: '2026-08-17' })],
    );

    expect(result.matched).toHaveLength(0);
  });

  it('excludes a credit that posts after the window closes', () => {
    const result = reconcileSettlements(
      [settlement({ date: '2026-08-01' })],
      [credit({ date: '2026-08-20' })],
    );

    expect(result.matched).toHaveLength(0);
  });

  it('honours a caller-supplied window', () => {
    const result = reconcileSettlements(
      [settlement({ date: '2026-08-01' })],
      [credit({ date: '2026-08-20' })],
      { windowDays: 30 },
    );

    expect(result.matched).toHaveLength(1);
  });

  it('does not match across currencies', () => {
    const result = reconcileSettlements(
      [settlement({ currency: 'EUR' })],
      [credit({ currency: 'USD' })],
    );

    expect(result.matched).toHaveLength(0);
  });

  it('uses each credit at most once when two payouts share an amount', () => {
    const settlements = [
      settlement({ id: 'po_1', date: '2026-08-18' }),
      settlement({ id: 'po_2', date: '2026-08-18' }),
    ];
    const credits = [credit({ providerTransactionId: 'txn-1', date: '2026-08-20' })];

    const result = reconcileSettlements(settlements, credits);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedSettlements).toHaveLength(1);
  });

  it('gives the earlier payout the earlier credit', () => {
    const settlements = [
      settlement({ id: 'po_late', date: '2026-08-10' }),
      settlement({ id: 'po_early', date: '2026-08-05' }),
    ];
    const credits = [
      credit({ providerTransactionId: 'txn-early', date: '2026-08-06' }),
      credit({ providerTransactionId: 'txn-late', date: '2026-08-11' }),
    ];

    const result = reconcileSettlements(settlements, credits);

    const pairs = Object.fromEntries(
      result.matched.map((m) => [m.settlement.id, m.transaction.providerTransactionId]),
    );
    expect(pairs).toEqual({ po_early: 'txn-early', po_late: 'txn-late' });
  });

  /**
   * Two identical credits on the same day are genuinely indistinguishable. Reporting
   * the pairing as certain would be the failure mode that matters most here: a
   * reconciliation that says "settled" when nobody actually checked.
   */
  it('flags a pairing as ambiguous when two credits fit equally well', () => {
    const credits = [
      credit({ providerTransactionId: 'txn-a', date: '2026-08-20' }),
      credit({ providerTransactionId: 'txn-b', date: '2026-08-20' }),
    ];

    const result = reconcileSettlements([settlement()], credits);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].ambiguous).toBe(true);
  });

  it('prefers the closest credit and does not flag ambiguity', () => {
    const credits = [
      credit({ providerTransactionId: 'txn-far', date: '2026-08-22' }),
      credit({ providerTransactionId: 'txn-near', date: '2026-08-19' }),
    ];

    const result = reconcileSettlements([settlement({ date: '2026-08-18' })], credits);

    expect(result.matched[0].transaction.providerTransactionId).toBe('txn-near');
    expect(result.matched[0].ambiguous).toBe(false);
  });

  it('returns unexplained credits so other income is visible', () => {
    const result = reconcileSettlements(
      [],
      [credit({ providerTransactionId: 'txn-other', description: 'Customer cheque' })],
    );

    expect(result.unmatchedCredits.map((c) => c.providerTransactionId)).toEqual(['txn-other']);
  });

  it('handles an empty settlement source without throwing', () => {
    // Today's real state: stripe_payouts is empty in production.
    const result = reconcileSettlements([], []);

    expect(result).toEqual({ matched: [], unmatchedSettlements: [], unmatchedCredits: [] });
  });

  it('skips settlements with an unparseable date instead of mismatching them', () => {
    const result = reconcileSettlements([settlement({ date: 'not-a-date' })], [credit()]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedSettlements).toHaveLength(1);
  });
});
