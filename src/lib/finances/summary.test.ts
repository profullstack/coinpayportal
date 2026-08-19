import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { toAccountView, aggregateAccounts, type FinanceAccount } from './summary';

function account(partial: Partial<FinanceAccount>): FinanceAccount {
  return {
    id: partial.id ?? 'acc-1',
    connection_id: 'conn-1',
    external_id: 'ACT-1',
    // `in` rather than `??`, so a test can pass an explicit null and mean it.
    org_name: 'org_name' in partial ? (partial.org_name ?? null) : 'Test Bank',
    org_domain: null,
    name: partial.name ?? 'Account',
    currency: partial.currency ?? 'USD',
    balance: 'balance' in partial ? (partial.balance ?? null) : 0,
    available_balance: partial.available_balance ?? null,
    balance_date: null,
    kind: partial.kind ?? 'unknown',
    kind_override: partial.kind_override ?? null,
    is_hidden: partial.is_hidden ?? false,
    last_seen_at: '2026-08-19T00:00:00.000Z',
  } as FinanceAccount;
}

describe('toAccountView', () => {
  it('states a card balance as a positive amount owed', () => {
    // SimpleFIN reports a $1,500.49 card debt as -1500.00.
    const view = toAccountView(account({ kind: 'credit', balance: -1500.00 }));
    expect(view.is_liability).toBe(true);
    expect(view.display_balance).toBe(1500.00);
  });

  it('leaves a deposit balance alone', () => {
    const view = toAccountView(account({ kind: 'checking', balance: 1000.00 }));
    expect(view.is_liability).toBe(false);
    expect(view.display_balance).toBe(1000.00);
  });

  it('shows an overpaid card as a negative amount owed, not a positive one', () => {
    // A credit balance on a card is stored positive. `Math.abs` would report it
    // as money owed; negating states the truth — the card owes you.
    const view = toAccountView(account({ kind: 'credit', balance: 120 }));
    expect(view.display_balance).toBe(-120);
  });

  it('lets an override move an account across the balance sheet', () => {
    const view = toAccountView(account({ kind: 'checking', kind_override: 'loan', balance: -500 }));
    expect(view.effective_kind).toBe('loan');
    expect(view.is_liability).toBe(true);
    expect(view.display_balance).toBe(500);
  });

  it('passes a null balance through untouched', () => {
    expect(toAccountView(account({ balance: null })).display_balance).toBeNull();
  });
});

describe('aggregateAccounts', () => {
  it('splits assets from debt and nets them', () => {
    const accounts = [
      account({ id: 'a', kind: 'checking', balance: 1000 }),
      account({ id: 'b', kind: 'savings', balance: 4200.00 }),
      account({ id: 'c', kind: 'credit', balance: -1500.00 }),
      account({ id: 'd', kind: 'credit', balance: -250.00 }),
    ].map(toAccountView);

    const { totals, primaryCurrency } = aggregateAccounts(accounts);
    expect(primaryCurrency).toBe('USD');
    expect(totals).toHaveLength(1);
    expect(totals[0].assets).toBeCloseTo(5200.00, 2);
    expect(totals[0].liabilities).toBeCloseTo(1750.00, 2);
    expect(totals[0].net).toBeCloseTo(3450.00, 2);
    expect(totals[0].accounts).toBe(4);
  });

  it('counts an unclassified negative balance as debt, not a negative asset', () => {
    // Netting is identical either way; the reported assets and debt are not.
    const { totals } = aggregateAccounts([
      account({ id: 'a', kind: 'checking', balance: 500 }),
      account({ id: 'b', kind: 'unknown', balance: -200 }),
    ].map(toAccountView));

    expect(totals[0].assets).toBe(500);
    expect(totals[0].liabilities).toBe(200);
    expect(totals[0].net).toBe(300);
  });

  it('never sums across currencies', () => {
    const { totals, primaryCurrency } = aggregateAccounts([
      account({ id: 'a', currency: 'USD', kind: 'checking', balance: 100 }),
      account({ id: 'b', currency: 'USD', kind: 'checking', balance: 200 }),
      account({ id: 'c', currency: 'EUR', kind: 'checking', balance: 50 }),
    ].map(toAccountView));

    expect(totals).toHaveLength(2);
    // The currency with the most accounts leads, and holds the headline figures.
    expect(primaryCurrency).toBe('USD');
    expect(totals.find((t) => t.currency === 'USD')?.assets).toBe(300);
    expect(totals.find((t) => t.currency === 'EUR')?.assets).toBe(50);
  });

  it('groups by institution with debt stated positive', () => {
    const { byInstitution } = aggregateAccounts([
      account({ id: 'a', org_name: 'Chase Bank', kind: 'credit', balance: -250.00 }),
      account({ id: 'b', org_name: 'Chase Bank', kind: 'credit', balance: -9000.00 }),
      account({ id: 'c', org_name: 'Bay Federal', kind: 'savings', balance: 4200.00 }),
    ].map(toAccountView));

    const chase = byInstitution.find((i) => i.org === 'Chase Bank');
    expect(chase?.liabilities).toBeCloseTo(9250.00, 2);
    expect(chase?.assets).toBe(0);
    expect(chase?.accounts).toBe(2);
    // Sorted by total exposure, so the largest position leads.
    expect(byInstitution[0].org).toBe('Chase Bank');
  });

  it('handles an empty account set without producing NaN', () => {
    const { totals, primaryCurrency, byKind } = aggregateAccounts([]);
    expect(totals).toEqual([]);
    expect(primaryCurrency).toBeNull();
    expect(byKind).toEqual([]);
  });

  it('names accounts with no institution rather than dropping them', () => {
    const { byInstitution } = aggregateAccounts([
      toAccountView(account({ org_name: null, kind: 'checking', balance: 10 })),
    ]);
    expect(byInstitution[0].org).toBe('Unknown institution');
  });
});
