import { describe, it, expect } from 'vitest';

import {
  buildPosition,
  effectiveScope,
  inferAccountScope,
  isAccountScope,
  recurrenceKey,
  type PositionAccount,
  type PositionTransaction,
} from './position';

const NOW = new Date('2026-09-06T00:00:00.000Z');

function account(partial: Partial<PositionAccount>): PositionAccount {
  return {
    id: partial.id ?? 'acc-1',
    name: partial.name ?? 'Checking',
    org_name: 'org_name' in partial ? (partial.org_name ?? null) : 'Test Bank',
    currency: partial.currency ?? 'USD',
    balance: 'balance' in partial ? (partial.balance ?? null) : 0,
    available_balance: partial.available_balance ?? null,
    effective_kind: partial.effective_kind ?? 'checking',
    is_liability: partial.is_liability ?? false,
    scope_override: partial.scope_override ?? null,
  };
}

function tx(partial: Partial<PositionTransaction>): PositionTransaction {
  return {
    account_id: partial.account_id ?? 'acc-1',
    posted: partial.posted ?? '2026-08-01T00:00:00.000Z',
    amount: partial.amount ?? 0,
    category: 'category' in partial ? (partial.category ?? null) : null,
    payee: partial.payee ?? null,
    description: partial.description ?? null,
  };
}

/** Same day of the month, `count` months back from August 2026. */
function monthlyDates(count: number, day = 22): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(2026, 7 - i, day));
    out.push(d.toISOString());
  }
  return out;
}

describe('inferAccountScope', () => {
  it('names a business account from the account name', () => {
    expect(inferAccountScope('Business Checking (4672)', 'Digital Federal Credit Union')).toBe('business');
    expect(inferAccountScope('Graphite™ Business Cash Unlimited Card (1009)', 'American Express')).toBe('business');
  });

  it('names a business account from the institution', () => {
    expect(inferAccountScope('Operating', 'Mercury Business Inc')).toBe('business');
  });

  it('falls back to personal, because there is no positive personal signal', () => {
    expect(inferAccountScope('A L Checking (XXXX4989)', 'Bay Federal Credit Union')).toBe('personal');
    expect(inferAccountScope(null, null)).toBe('personal');
  });
});

describe('effectiveScope', () => {
  it('lets a stored override beat the name', () => {
    // The case the name cannot see: a personal-looking card carrying company
    // spend, and a business-named account that is really the owner's.
    expect(effectiveScope({ name: 'Costco Anywhere Visa', scope_override: 'business' })).toBe('business');
    expect(effectiveScope({ name: 'Business Checking (4672)', scope_override: 'personal' })).toBe('personal');
  });

  it('falls back to the guess when there is no override', () => {
    expect(effectiveScope({ name: 'Business Checking (4672)', scope_override: null })).toBe('business');
    expect(effectiveScope({ name: 'A L Checking' })).toBe('personal');
  });

  it('ignores a junk override rather than inventing a third set of books', () => {
    expect(effectiveScope({ name: 'Business Checking', scope_override: 'corporate' })).toBe('business');
    expect(effectiveScope({ name: 'A L Checking', scope_override: '' })).toBe('personal');
  });

  it('reads the institution when the account name is silent', () => {
    expect(effectiveScope({ name: 'Operating', org_name: 'Mercury Business Inc' })).toBe('business');
  });
});

describe('isAccountScope', () => {
  it('accepts only the two sides', () => {
    expect(isAccountScope('business')).toBe(true);
    expect(isAccountScope('personal')).toBe(true);
    expect(isAccountScope('corporate')).toBe(false);
    expect(isAccountScope(null)).toBe(false);
    expect(isAccountScope(undefined)).toBe(false);
  });
});

describe('recurrenceKey', () => {
  it('groups the same merchant across different store numbers', () => {
    const a = recurrenceKey(tx({ payee: 'CHEVRON 00123456' }));
    const b = recurrenceKey(tx({ payee: 'CHEVRON 00987654' }));
    expect(a).toBe(b);
    expect(a).toBe('chevron');
  });

  it('keeps genuinely different merchants apart', () => {
    expect(recurrenceKey(tx({ payee: 'Chevron' }))).not.toBe(recurrenceKey(tx({ payee: 'Shell' })));
  });

  it('falls back to the description when there is no payee', () => {
    expect(recurrenceKey(tx({ description: 'STATE OF CALIF DMV' }))).toBe('state of calif dmv');
  });
});

describe('buildPosition — credits and debits', () => {
  const accounts = [
    account({ id: 'chk', name: 'Checking', effective_kind: 'checking', balance: 5000 }),
    account({ id: 'card', name: 'Visa Signature', effective_kind: 'credit', is_liability: true, balance: -2000 }),
  ];

  it('excludes transfers and card payments from both sides', () => {
    const p = buildPosition({
      accounts,
      lookbackDays: 30.44,
      now: NOW,
      transactions: [
        tx({ account_id: 'chk', amount: 4000, category: 'income', payee: 'Payroll' }),
        tx({ account_id: 'chk', amount: -500, category: 'payment', payee: 'Card Payment' }),
        tx({ account_id: 'card', amount: 500, category: 'payment', payee: 'Payment Thank You' }),
        tx({ account_id: 'card', amount: -300, category: 'dining', payee: 'Restaurant' }),
      ],
    });

    // The $500 card payment appears twice in the feed and must count as
    // neither income nor spending, or both sides inflate by $500.
    expect(p.income.total).toBe(4000);
    expect(p.spending.total).toBe(300);
    expect(p.net.total).toBe(3700);

    // The raw sides still show the money that moved.
    expect(p.income.grossCredits).toBe(4500);
    expect(p.spending.grossDebits).toBe(800);
  });

  it('counts debt service once, on the liability side', () => {
    const p = buildPosition({
      accounts,
      lookbackDays: 30.44,
      now: NOW,
      transactions: [
        tx({ account_id: 'chk', amount: -500, category: 'payment' }),
        tx({ account_id: 'card', amount: 500, category: 'payment' }),
      ],
    });
    expect(p.debt.servicePerMonth).toBe(500);
  });

  it('treats a card credit that is not a payment as a refund, not income', () => {
    const p = buildPosition({
      accounts,
      lookbackDays: 30.44,
      now: NOW,
      transactions: [
        tx({ account_id: 'card', amount: -300, category: 'shopping' }),
        tx({ account_id: 'card', amount: 100, category: 'shopping', payee: 'Returned item' }),
      ],
    });
    expect(p.income.total).toBe(0);
    expect(p.spending.refunds).toBe(100);
    expect(p.spending.total).toBe(200);
  });
});

describe('buildPosition — debt', () => {
  it('splits revolving from instalment and states debt positive', () => {
    const p = buildPosition({
      accounts: [
        account({ id: 'card', name: 'Visa', effective_kind: 'credit', is_liability: true, balance: -1500 }),
        account({ id: 'auto', name: 'Auto Loan', effective_kind: 'loan', is_liability: true, balance: -20000 }),
        account({ id: 'chk', name: 'Checking', balance: 1000 }),
      ],
      transactions: [],
      lookbackDays: 180,
      now: NOW,
    });
    expect(p.debt.total).toBe(21500);
    expect(p.debt.revolving).toBe(1500);
    expect(p.debt.instalment).toBe(20000);
    expect(p.debt.accounts[0].name).toBe('Auto Loan');
    expect(p.debt.accounts[0].share).toBe(0.93);
  });

  it('reports no payoff date when nothing is being paid down', () => {
    const p = buildPosition({
      accounts: [account({ id: 'card', effective_kind: 'credit', is_liability: true, balance: -1000 })],
      transactions: [],
      lookbackDays: 180,
      now: NOW,
    });
    expect(p.debt.payoffMonths).toBeNull();
    expect(p.debt.payoffDate).toBeNull();
  });

  it('projects a payoff from the recent payment rate', () => {
    const p = buildPosition({
      accounts: [account({ id: 'card', effective_kind: 'credit', is_liability: true, balance: -1200 })],
      // Six payments of $200 against $1,200 owed. The oldest is 168 days back,
      // so the rate divides by 5.52 months of history rather than the 6 months
      // the query reached for — see `observedDays`.
      transactions: monthlyDates(6).map((posted) => tx({ account_id: 'card', posted, amount: 200, category: 'payment' })),
      lookbackDays: 182.64,
      now: NOW,
    });
    expect(p.observedDays).toBeCloseTo(168, 0);
    expect(p.debt.servicePerMonth).toBeCloseTo(217.4, 1);
    expect(p.debt.payoffMonths).toBe(6);
    expect(p.debt.payoffDate?.slice(0, 7)).toBe('2027-03');
  });

  it('divides monthly figures by the history that exists, not the window asked for', () => {
    // A feed linked six weeks ago, queried for six months. Dividing $3,000 of
    // spending by six months would report $500/mo for someone spending $2,000.
    const posted = [7, 21, 35].map((d) => new Date(NOW.getTime() - d * 86_400_000).toISOString());
    const p = buildPosition({
      accounts: [account({ id: 'chk', balance: 0 })],
      transactions: posted.map((at) => tx({ account_id: 'chk', posted: at, amount: -1000, category: 'shopping' })),
      lookbackDays: 180,
      now: NOW,
    });
    expect(p.lookbackDays).toBe(180);
    expect(p.observedDays).toBeCloseTo(35, 0);
    expect(p.monthsObserved).toBeCloseTo(1.15, 1);
    expect(p.spending.perMonth).toBeCloseTo(2609, 0);
  });

  it('never divides by more history than was asked for', () => {
    // Three years of rows behind a 180-day query: the cap keeps the rate
    // describing the window, not the whole archive.
    const posted = [10, 400, 900].map((d) => new Date(NOW.getTime() - d * 86_400_000).toISOString());
    const p = buildPosition({
      accounts: [account({ id: 'chk', balance: 0 })],
      transactions: posted.map((at) => tx({ account_id: 'chk', posted: at, amount: -100, category: 'shopping' })),
      lookbackDays: 180,
      now: NOW,
    });
    expect(p.observedDays).toBe(180);
  });

  it('flags a feed with no liability account rather than reporting zero debt as fact', () => {
    const p = buildPosition({
      accounts: [account({ id: 'chk', balance: 100 })],
      transactions: [],
      lookbackDays: 180,
      now: NOW,
    });
    expect(p.debt.total).toBe(0);
    expect(p.confidence.noLiabilityAccounts).toBe(true);
  });

  it('derives card utilisation from the remaining credit', () => {
    const p = buildPosition({
      accounts: [
        account({ id: 'card', effective_kind: 'credit', is_liability: true, balance: -2500, available_balance: 7500 }),
      ],
      transactions: [],
      lookbackDays: 180,
      now: NOW,
    });
    // $2,500 drawn against a $10,000 limit.
    expect(p.ratios.creditUtilisation).toBe(0.25);
  });

  it('leaves utilisation null when no limit can be derived', () => {
    const p = buildPosition({
      accounts: [account({ id: 'card', effective_kind: 'credit', is_liability: true, balance: -2500 })],
      transactions: [],
      lookbackDays: 180,
      now: NOW,
    });
    expect(p.ratios.creditUtilisation).toBeNull();
  });
});

describe('buildPosition — ratios', () => {
  it('computes debt to income against annualised income', () => {
    const p = buildPosition({
      accounts: [
        account({ id: 'chk', balance: 3000 }),
        account({ id: 'card', effective_kind: 'credit', is_liability: true, balance: -12000 }),
      ],
      // $2,000/mo for six months → $24,000/yr against $12,000 owed.
      transactions: monthlyDates(6, 1).map((posted) => tx({ account_id: 'chk', posted, amount: 2000, category: 'income' })),
      lookbackDays: 182.64,
      now: NOW,
    });
    expect(p.income.perMonth).toBe(2000);
    expect(p.ratios.debtToIncome).toBe(0.5);
  });

  it('leaves every ratio null rather than dividing by zero income', () => {
    const p = buildPosition({
      accounts: [account({ id: 'card', effective_kind: 'credit', is_liability: true, balance: -500 })],
      transactions: [],
      lookbackDays: 180,
      now: NOW,
    });
    expect(p.ratios.debtToIncome).toBeNull();
    expect(p.ratios.debtServiceRatio).toBeNull();
    expect(p.ratios.monthsOfCover).toBeNull();
    expect(p.net.savingsRate).toBeNull();
  });

  it('counts only spendable accounts towards months of cover', () => {
    const p = buildPosition({
      accounts: [
        account({ id: 'chk', effective_kind: 'checking', balance: 3000 }),
        account({ id: 'ira', name: 'Roth IRA', effective_kind: 'investment', balance: 90000 }),
      ],
      transactions: monthlyDates(6, 5).map((posted) => tx({ account_id: 'chk', posted, amount: -1000, category: 'shopping' })),
      lookbackDays: 182.64,
      now: NOW,
    });
    // $3,000 liquid against $1,000/mo spending — the retirement account is an
    // asset but it is not runway.
    expect(p.ratios.monthsOfCover).toBe(3);
  });
});

describe('buildPosition — recurring', () => {
  const accounts = [account({ id: 'chk', balance: 1000 })];

  it('detects a monthly charge and projects the next one', () => {
    const p = buildPosition({
      accounts,
      transactions: monthlyDates(6).map((posted) => tx({ account_id: 'chk', posted, amount: -560.12, payee: 'Chrysler Capital', category: 'payment' })),
      lookbackDays: 182.64,
      now: NOW,
    });
    const charge = p.recurring.charges.find((c) => c.payee.startsWith('Chrysler'));
    expect(charge).toBeDefined();
    expect(charge?.cadence).toBe('monthly');
    expect(charge?.amount).toBe(560.12);
    expect(charge?.occurrences).toBe(6);
    expect(charge?.nextExpected.slice(0, 7)).toBe('2026-09');
    expect(p.recurring.monthlyTotal).toBe(560.12);
  });

  it('ignores a merchant whose amount swings, which is a habit not an obligation', () => {
    const amounts = [12, 140, 8, 96, 31, 210];
    const p = buildPosition({
      accounts,
      transactions: monthlyDates(6).map((posted, i) => tx({ account_id: 'chk', posted, amount: -amounts[i], payee: 'Corner Store' })),
      lookbackDays: 182.64,
      now: NOW,
    });
    expect(p.recurring.charges).toHaveLength(0);
  });

  it('ignores a charge that stopped months ago', () => {
    // Six monthly charges that all ended in March.
    const old = [0, 1, 2, 3, 4, 5].map((i) => new Date(Date.UTC(2025, 9 + i, 15)).toISOString());
    const p = buildPosition({
      accounts,
      transactions: old.map((posted) => tx({ account_id: 'chk', posted, amount: -40, payee: 'Old Gym' })),
      lookbackDays: 400,
      now: NOW,
    });
    expect(p.recurring.charges).toHaveLength(0);
  });

  it('needs three sightings before naming a cadence', () => {
    const p = buildPosition({
      accounts,
      transactions: monthlyDates(2).map((posted) => tx({ account_id: 'chk', posted, amount: -40, payee: 'New Thing' })),
      lookbackDays: 182.64,
      now: NOW,
    });
    expect(p.recurring.charges).toHaveLength(0);
  });

  it('marks a recurring payment onto a card as debt service', () => {
    const p = buildPosition({
      accounts: [account({ id: 'card', effective_kind: 'credit', is_liability: true, balance: -900 })],
      transactions: monthlyDates(6).map((posted) => tx({ account_id: 'card', posted, amount: 300, category: 'payment', payee: 'Autopay' })),
      lookbackDays: 182.64,
      now: NOW,
    });
    expect(p.recurring.charges[0]?.isDebtService).toBe(true);
    expect(p.recurring.monthlyDebtService).toBe(300);
  });
});

describe('buildPosition — months and confidence', () => {
  it('marks the first and last months partial', () => {
    const p = buildPosition({
      accounts: [account({ id: 'chk', balance: 0 })],
      transactions: monthlyDates(4).map((posted) => tx({ account_id: 'chk', posted, amount: -10, category: 'shopping' })),
      lookbackDays: 121.76,
      now: NOW,
    });
    expect(p.months).toHaveLength(4);
    expect(p.months[0].partial).toBe(true);
    expect(p.months[3].partial).toBe(true);
    expect(p.months[1].partial).toBe(false);
  });

  it('reports the uncategorised share so a rough split is readable as rough', () => {
    const p = buildPosition({
      accounts: [account({ id: 'chk', balance: 0 })],
      transactions: [
        tx({ account_id: 'chk', amount: -10, category: 'dining' }),
        tx({ account_id: 'chk', amount: -10, category: null }),
        tx({ account_id: 'chk', amount: -10, category: null }),
        tx({ account_id: 'chk', amount: -10, category: null }),
      ],
      lookbackDays: 30.44,
      now: NOW,
    });
    expect(p.confidence.uncategorisedShare).toBe(0.75);
    expect(p.confidence.transactions).toBe(4);
  });

  it('drops transactions belonging to another currency rather than summing them', () => {
    const p = buildPosition({
      accounts: [
        account({ id: 'usd', currency: 'USD', balance: 100 }),
        account({ id: 'eur', currency: 'EUR', balance: 100 }),
      ],
      transactions: [
        tx({ account_id: 'usd', amount: 100, category: 'income' }),
        tx({ account_id: 'eur', amount: 900, category: 'income' }),
      ],
      lookbackDays: 30.44,
      now: NOW,
    });
    expect(p.currency).toBe('USD');
    expect(p.income.total).toBe(100);
  });

  it('ignores a transaction whose account is not in the set', () => {
    const p = buildPosition({
      accounts: [account({ id: 'chk', balance: 0 })],
      transactions: [tx({ account_id: 'hidden-account', amount: 5000, category: 'income' })],
      lookbackDays: 30.44,
      now: NOW,
    });
    expect(p.income.total).toBe(0);
    expect(p.confidence.transactions).toBe(0);
  });
});

describe('buildPosition — business against personal', () => {
  it('routes an account to the overridden side, not the guessed one', () => {
    const p = buildPosition({
      accounts: [
        // Reads personal by name; the operator says it is the company card.
        account({
          id: 'card',
          name: 'Costco Anywhere Visa (4294)',
          effective_kind: 'credit',
          is_liability: true,
          balance: -5000,
          scope_override: 'business',
        }),
      ],
      transactions: [tx({ account_id: 'card', amount: -900, category: 'software' })],
      lookbackDays: 30.44,
      now: NOW,
    });
    const business = p.scopes.find((s) => s.scope === 'business');
    expect(business?.debt).toBe(5000);
    expect(business?.spending).toBe(900);
    expect(p.scopes.find((s) => s.scope === 'personal')).toBeUndefined();
    expect(p.debt.accounts[0].scope).toBe('business');
  });


  it('splits flows and debt by the side each account sits on', () => {
    const p = buildPosition({
      accounts: [
        account({ id: 'biz', name: 'Business Checking (4672)', balance: 8000 }),
        account({ id: 'personal', name: 'Free Checking (0849)', balance: 500 }),
        account({ id: 'bizcard', name: 'Business Cash Card', effective_kind: 'credit', is_liability: true, balance: -4000 }),
      ],
      transactions: [
        tx({ account_id: 'biz', amount: 10000, category: 'income' }),
        tx({ account_id: 'personal', amount: 2000, category: 'income' }),
        tx({ account_id: 'bizcard', amount: -1500, category: 'software' }),
      ],
      lookbackDays: 30.44,
      now: NOW,
    });

    const business = p.scopes.find((s) => s.scope === 'business');
    const personal = p.scopes.find((s) => s.scope === 'personal');
    expect(business?.income).toBe(10000);
    expect(business?.spending).toBe(1500);
    expect(business?.debt).toBe(4000);
    expect(personal?.income).toBe(2000);
    expect(personal?.debt).toBe(0);
  });
});
