import { type AccountKind } from './classify';

/**
 * Debt against income: the basic-accounting view of a linked feed.
 *
 * The balance sheet in `summary.ts` answers "what do I have and what do I
 * owe". This module answers the two questions that follow — "what comes in
 * against what goes out" and "how long does the debt take to clear" — for a
 * person or a company reading the same feed.
 *
 * Three rules shape all of it.
 *
 * **Internal money movement is not income and not spending.** A feed that has
 * both a checking account and the credit card it pays holds every card payment
 * twice: a debit on checking and a credit on the card. Counting raw credits as
 * income and raw debits as spending therefore inflates both by the entire
 * card-payment volume, and the error grows with how completely someone links
 * their accounts. Transfers and card payments are excluded from both sides
 * here, and the raw figures are reported alongside as `grossCredits` /
 * `grossDebits` so the difference is visible rather than hidden.
 *
 * **A credit on a card is not income.** It is a refund, a statement credit or
 * a payment. Refunds reduce spending; payments are debt service. Neither adds
 * to what someone earned.
 *
 * **Confidence is reported, never assumed.** Every figure here rests on the
 * stored category, which is itself inferred (see `classify.ts`). The share of
 * rows that carry no category travels with the result as `uncategorisedShare`,
 * because a split derived from 40%-categorised data deserves to be read
 * differently from one derived from 95%.
 */

/** Categories that move money between the reader's own accounts. */
const INTERNAL_CATEGORIES = new Set(['transfer', 'payment']);

/** Cadences recurring detection will name, as days between occurrences. */
const CADENCES: Array<{ name: RecurrenceCadence; days: number; tolerance: number; perYear: number }> = [
  { name: 'weekly', days: 7, tolerance: 2, perYear: 52 },
  { name: 'biweekly', days: 14, tolerance: 3, perYear: 26 },
  { name: 'monthly', days: 30.44, tolerance: 5, perYear: 12 },
  { name: 'quarterly', days: 91.3, tolerance: 12, perYear: 4 },
  { name: 'annual', days: 365.25, tolerance: 30, perYear: 1 },
];

export type RecurrenceCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';

/** Which side of the reader's life an account belongs to. */
export type AccountScope = 'business' | 'personal';

/**
 * Business account names, matched against the account and institution name.
 *
 * Only `business` is positively detected. There is no reliable signal for
 * "this is a personal account" — the absence of a business word is all there
 * is — so everything unmatched falls to `personal`, and `businessAccounts`
 * reports how many were actually named. A split where that count is zero is
 * telling you the feed has no business accounts it could identify, not that
 * the reader has none.
 */
const BUSINESS_PATTERN =
  /\b(business|commercial|corporate|corp|company|co\.|llc|l\.l\.c|inc\b|incorporated|ltd|limited|merchant|payroll|vendor|operating|escrow)\b/i;

export const ACCOUNT_SCOPES: AccountScope[] = ['business', 'personal'];

export function isAccountScope(value: unknown): value is AccountScope {
  return typeof value === 'string' && (ACCOUNT_SCOPES as string[]).includes(value);
}

export function inferAccountScope(
  name: string | null | undefined,
  orgName?: string | null,
): AccountScope {
  for (const haystack of [name ?? '', orgName ?? '']) {
    if (haystack.trim() && BUSINESS_PATTERN.test(haystack)) return 'business';
  }
  return 'personal';
}

/**
 * The scope actually in force: an operator override always beats the guess.
 *
 * Mirrors `effectiveKind`. The guess is right about an account named
 * "Business Checking" and blind to a personal card carrying company spend, so
 * the correction has to be stored and has to win.
 */
export function effectiveScope(row: {
  name?: string | null;
  org_name?: string | null;
  scope_override?: string | null;
}): AccountScope {
  if (isAccountScope(row.scope_override)) return row.scope_override;
  return inferAccountScope(row.name, row.org_name);
}

/** The account fields this module reads. Structural, so tests need no database. */
export interface PositionAccount {
  id: string;
  name: string;
  org_name: string | null;
  currency: string;
  balance: number | null;
  available_balance?: number | null;
  effective_kind: AccountKind;
  is_liability: boolean;
  /** Operator correction; when set it decides the scope outright. */
  scope_override?: string | null;
}

/** The transaction fields this module reads. */
export interface PositionTransaction {
  account_id: string;
  posted: string;
  amount: number;
  category: string | null;
  payee?: string | null;
  description?: string | null;
}

export interface MonthFlow {
  /** Calendar month as `YYYY-MM`. */
  month: string;
  income: number;
  spending: number;
  net: number;
  debtService: number;
  transactions: number;
  /** True when the month is only partly covered by the data. */
  partial: boolean;
}

export interface DebtAccount {
  id: string;
  name: string;
  org: string | null;
  kind: AccountKind;
  scope: AccountScope;
  /** Positive amount owed. */
  owed: number;
  /** Share of total debt, 0-1. */
  share: number;
  /** Payments made to this account inside the window, if any. */
  paid: number;
  /** Months to clear this balance at its own recent payment rate, or null. */
  payoffMonths: number | null;
}

export interface RecurringCharge {
  payee: string;
  /** Median amount, stated positive for a debit. */
  amount: number;
  cadence: RecurrenceCadence;
  occurrences: number;
  lastSeen: string;
  /** Projected next occurrence, from the last one plus the cadence. */
  nextExpected: string;
  /** The charge normalised to a monthly cost, for summing. */
  monthlyEquivalent: number;
  scope: AccountScope;
  /** True when it lands on a liability account — a debt payment, not a bill. */
  isDebtService: boolean;
}

export interface ScopeFlow {
  scope: AccountScope;
  accounts: number;
  assets: number;
  debt: number;
  income: number;
  spending: number;
  net: number;
}

export interface Position {
  currency: string | null;
  /** Days of history that were asked for. */
  lookbackDays: number;
  /**
   * Days of history that actually exist: from the oldest transaction to now,
   * never more than `lookbackDays`. This is what the monthly averages divide
   * by, and it is usually the smaller number — a feed linked six weeks ago
   * holds six weeks of rows however far back the query reached.
   */
  observedDays: number;
  /** `observedDays` as months. What every `perMonth` figure divides by. */
  monthsObserved: number;
  months: MonthFlow[];

  income: {
    /** Credits that are neither internal movement nor a card refund. */
    total: number;
    perMonth: number;
    /** Every credit, including transfers and card payments. */
    grossCredits: number;
    transactions: number;
  };

  spending: {
    /** Debits that are not internal movement, less refunds. */
    total: number;
    perMonth: number;
    /** Every debit, including transfers and card payments. */
    grossDebits: number;
    refunds: number;
    transactions: number;
  };

  net: {
    total: number;
    perMonth: number;
    /** Share of income kept, 0-1, or null when there is no income. */
    savingsRate: number | null;
  };

  debt: {
    total: number;
    /** Card debt, which revolves. */
    revolving: number;
    /** Loan debt, which amortises. */
    instalment: number;
    accounts: DebtAccount[];
    /** Payments to liability accounts, per month. */
    servicePerMonth: number;
    /** Months to clear all debt at the current payment rate, before interest. */
    payoffMonths: number | null;
    /** Projected clear date, or null when nothing is being paid down. */
    payoffDate: string | null;
  };

  ratios: {
    /** Total debt over annualised income. The classic solvency read. */
    debtToIncome: number | null;
    /** Debt payments over income. Lenders look for under 0.36. */
    debtServiceRatio: number | null;
    /** Liquid assets over monthly spending: months of runway. */
    monthsOfCover: number | null;
    /** Card balances over available credit, or null without limits. */
    creditUtilisation: number | null;
  };

  recurring: {
    charges: RecurringCharge[];
    /** Every detected charge normalised to a monthly total. */
    monthlyTotal: number;
    /** The debt-service part of that total. */
    monthlyDebtService: number;
  };

  scopes: ScopeFlow[];

  confidence: {
    /** Share of rows carrying no category, 0-1. Higher means less reliable. */
    uncategorisedShare: number;
    transactions: number;
    /** True when no liability account is linked, so debt figures are blind. */
    noLiabilityAccounts: boolean;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Median of a numeric list. Resistant to the one outlier month a mean is not. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Reduce a payee to a key that survives the noise institutions add.
 *
 * Store numbers, reference codes and dates are what stop the same monthly
 * charge from grouping with itself, so digits and punctuation go. What remains
 * is lowercased words, which is enough for "CHEVRON 00123456" and
 * "CHEVRON 00987654" to land together without merging genuinely different
 * merchants.
 */
export function recurrenceKey(tx: PositionTransaction): string {
  const raw = (tx.payee || tx.description || '').toLowerCase();
  return raw
    .replace(/[#*]/g, ' ')
    .replace(/\b[a-z]*\d[a-z0-9]*\b/g, ' ')
    .replace(/[^a-z\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** The cadence a set of gaps fits, or null when they fit none. */
function matchCadence(gaps: number[]): { name: RecurrenceCadence; perYear: number } | null {
  if (gaps.length === 0) return null;
  const typical = median(gaps);
  for (const c of CADENCES) {
    if (Math.abs(typical - c.days) <= c.tolerance) return { name: c.name, perYear: c.perYear };
  }
  return null;
}

function detectRecurring(
  rows: Array<{ tx: PositionTransaction; scope: AccountScope; isLiability: boolean }>,
  now: Date,
): RecurringCharge[] {
  const groups = new Map<string, Array<{ tx: PositionTransaction; scope: AccountScope; isLiability: boolean }>>();

  for (const row of rows) {
    // A recurring obligation is money leaving on a deposit account, or a
    // payment landing on a card. Ordinary card purchases are debits too, so
    // both signs qualify depending on which side of the feed the row is on.
    const isOutflow = row.isLiability ? row.tx.amount > 0 : row.tx.amount < 0;
    if (!isOutflow) continue;
    const key = recurrenceKey(row.tx);
    if (key.length < 3) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const charges: RecurringCharge[] = [];

  for (const [key, list] of groups) {
    if (list.length < 3) continue;

    const sorted = [...list].sort((a, b) => a.tx.posted.localeCompare(b.tx.posted));
    const times = sorted.map((r) => new Date(r.tx.posted).getTime()).filter((t) => Number.isFinite(t));
    if (times.length < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < times.length; i += 1) gaps.push((times[i] - times[i - 1]) / 86_400_000);

    const cadence = matchCadence(gaps);
    if (!cadence) continue;

    const amounts = sorted.map((r) => Math.abs(r.tx.amount));
    const typicalAmount = median(amounts);
    if (typicalAmount <= 0) continue;

    // A charge whose amount swings wildly is a merchant visited often, not a
    // fixed obligation. Half the median is a wide enough band to keep a
    // variable utility bill and narrow enough to drop a grocery store.
    const spread = median(amounts.map((a) => Math.abs(a - typicalAmount)));
    if (spread > typicalAmount * 0.5) continue;

    const last = sorted[sorted.length - 1];
    const lastTime = new Date(last.tx.posted).getTime();
    const intervalDays = CADENCES.find((c) => c.name === cadence.name)?.days ?? 30.44;

    // A charge whose last sighting is more than two intervals old has stopped.
    if (now.getTime() - lastTime > intervalDays * 2 * 86_400_000) continue;

    charges.push({
      payee: (last.tx.payee || last.tx.description || key).slice(0, 40),
      amount: round2(typicalAmount),
      cadence: cadence.name,
      occurrences: sorted.length,
      lastSeen: last.tx.posted,
      nextExpected: new Date(lastTime + intervalDays * 86_400_000).toISOString(),
      monthlyEquivalent: round2((typicalAmount * cadence.perYear) / 12),
      scope: last.scope,
      isDebtService: last.isLiability,
    });
  }

  return charges.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

/**
 * Build the debt-and-income view.
 *
 * Pure: every figure comes from the two arrays passed in, so the whole thing
 * is testable against fixtures and the caller decides what history to fetch.
 *
 * @param lookbackDays how much history `transactions` covers. Only used to
 *        state the provenance of the result and to size the month averages —
 *        it does not filter, because filtering is the caller's job.
 */
export function buildPosition({
  accounts,
  transactions,
  lookbackDays,
  now = new Date(),
}: {
  accounts: PositionAccount[];
  transactions: PositionTransaction[];
  lookbackDays: number;
  now?: Date;
}): Position {
  const currency = accounts[0]?.currency ?? null;

  // Only the primary currency contributes; mixing them into one figure would
  // be arithmetic on incomparable units.
  const inScope = currency ? accounts.filter((a) => (a.currency || 'USD') === currency) : accounts;
  const accountById = new Map(inScope.map((a) => [a.id, a]));
  const scopeOf = new Map<string, AccountScope>(inScope.map((a) => [a.id, effectiveScope(a)]));

  const rows = transactions
    .filter((t) => accountById.has(t.account_id))
    .map((tx) => {
      const account = accountById.get(tx.account_id)!;
      return {
        tx,
        account,
        scope: scopeOf.get(tx.account_id) ?? ('personal' as AccountScope),
        isLiability: account.is_liability,
        internal: INTERNAL_CATEGORIES.has(String(tx.category ?? '')),
      };
    });

  // ── Flows ──

  let income = 0;
  let incomeCount = 0;
  let spending = 0;
  let spendingCount = 0;
  let refunds = 0;
  let grossCredits = 0;
  let grossDebits = 0;
  let debtService = 0;
  let uncategorised = 0;

  const monthMap = new Map<string, MonthFlow>();
  const scopeMap = new Map<AccountScope, ScopeFlow>();

  const touchMonth = (key: string): MonthFlow => {
    let m = monthMap.get(key);
    if (!m) {
      m = { month: key, income: 0, spending: 0, net: 0, debtService: 0, transactions: 0, partial: false };
      monthMap.set(key, m);
    }
    return m;
  };
  const touchScope = (scope: AccountScope): ScopeFlow => {
    let s = scopeMap.get(scope);
    if (!s) {
      s = { scope, accounts: 0, assets: 0, debt: 0, income: 0, spending: 0, net: 0 };
      scopeMap.set(scope, s);
    }
    return s;
  };

  for (const row of rows) {
    const amount = Number(row.tx.amount);
    if (!Number.isFinite(amount)) continue;

    const month = touchMonth(monthKey(row.tx.posted));
    const scope = touchScope(row.scope);
    month.transactions += 1;
    if (!row.tx.category) uncategorised += 1;

    if (amount >= 0) grossCredits += amount;
    else grossDebits += -amount;

    // A payment landing on a card is debt service. Counted on the liability
    // side only: the matching debit on the funding account is the same event,
    // and adding both would double it.
    if (row.internal) {
      if (row.isLiability && amount > 0) {
        debtService += amount;
        month.debtService += amount;
      }
      continue;
    }

    if (row.isLiability) {
      if (amount > 0) {
        // A non-payment credit on a card is a refund: it reduces spending.
        refunds += amount;
        month.spending -= amount;
        scope.spending -= amount;
      } else {
        spending += -amount;
        spendingCount += 1;
        month.spending += -amount;
        scope.spending += -amount;
      }
      continue;
    }

    if (amount > 0) {
      income += amount;
      incomeCount += 1;
      month.income += amount;
      scope.income += amount;
    } else {
      spending += -amount;
      spendingCount += 1;
      month.spending += -amount;
      scope.spending += -amount;
    }
  }

  spending -= refunds;

  // ── Balances ──

  let totalDebt = 0;
  let revolving = 0;
  let instalment = 0;
  let liquidAssets = 0;
  let cardBalances = 0;
  let cardLimits = 0;
  let liabilityAccounts = 0;

  const paidByAccount = new Map<string, number>();
  for (const row of rows) {
    if (row.isLiability && row.internal && row.tx.amount > 0) {
      paidByAccount.set(row.tx.account_id, (paidByAccount.get(row.tx.account_id) ?? 0) + row.tx.amount);
    }
  }

  const debtAccounts: DebtAccount[] = [];

  for (const account of inScope) {
    const scope = touchScope(scopeOf.get(account.id) ?? 'personal');
    scope.accounts += 1;
    const balance = Number(account.balance ?? 0);

    if (account.is_liability) {
      liabilityAccounts += 1;
      const owed = -balance;
      scope.debt += owed;
      if (owed > 0) {
        totalDebt += owed;
        if (account.effective_kind === 'loan') instalment += owed;
        else revolving += owed;
      }
      if (account.effective_kind === 'credit') {
        cardBalances += Math.max(0, owed);
        // SimpleFIN reports a card's remaining credit as `available_balance`;
        // the limit is that plus what is already drawn. Absent it, the account
        // simply does not contribute to utilisation rather than distorting it.
        const available = account.available_balance;
        if (typeof available === 'number' && available > 0) cardLimits += available + Math.max(0, owed);
      }
      continue;
    }

    if (balance > 0) {
      scope.assets += balance;
      // Runway is what can be spent, so investments are excluded: they are
      // assets but not cover.
      if (account.effective_kind === 'checking' || account.effective_kind === 'savings' || account.effective_kind === 'cash') {
        liquidAssets += balance;
      }
    }
  }

  // ── Months ──

  const months = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of months) {
    m.income = round2(m.income);
    m.spending = round2(m.spending);
    m.debtService = round2(m.debtService);
    m.net = round2(m.income - m.spending);
  }

  // The first and last months are almost never whole, so averaging over the
  // month count would divide by more months than were actually observed.
  if (months.length > 0) {
    months[0].partial = true;
    months[months.length - 1].partial = true;
  }

  // Divide by the history that exists, not the history that was asked for.
  // A feed linked six weeks ago answers a 180-day query with six weeks of
  // rows; dividing those by six months understates every monthly figure by
  // two thirds, and understating debt service is what turns a two-year payoff
  // into a phantom four-year one.
  let earliest = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const t = Date.parse(row.tx.posted);
    if (Number.isFinite(t) && t < earliest) earliest = t;
  }
  const observedDays = Number.isFinite(earliest)
    ? Math.max(1, Math.min(lookbackDays, (now.getTime() - earliest) / 86_400_000))
    : lookbackDays;
  const monthsObserved = observedDays > 0 ? observedDays / 30.44 : 0;
  const perMonth = (total: number): number => (monthsObserved > 0 ? round2(total / monthsObserved) : 0);

  const incomePerMonth = perMonth(income);
  const spendingPerMonth = perMonth(spending);
  const servicePerMonth = perMonth(debtService);
  const netTotal = income - spending;

  for (const s of scopeMap.values()) {
    s.assets = round2(s.assets);
    s.debt = round2(s.debt);
    s.income = round2(s.income);
    s.spending = round2(s.spending);
    s.net = round2(s.income - s.spending);
  }

  // ── Debt detail ──

  for (const account of inScope) {
    if (!account.is_liability) continue;
    const owed = -Number(account.balance ?? 0);
    if (owed <= 0) continue;
    const paid = paidByAccount.get(account.id) ?? 0;
    const paidPerMonth = monthsObserved > 0 ? paid / monthsObserved : 0;
    debtAccounts.push({
      id: account.id,
      name: account.name,
      org: account.org_name,
      kind: account.effective_kind,
      scope: scopeOf.get(account.id) ?? 'personal',
      owed: round2(owed),
      share: 0,
      paid: round2(paid),
      payoffMonths: paidPerMonth > 0 ? Math.ceil(owed / paidPerMonth) : null,
    });
  }
  debtAccounts.sort((a, b) => b.owed - a.owed);
  for (const d of debtAccounts) d.share = totalDebt > 0 ? round2(d.owed / totalDebt) : 0;

  const payoffMonths = servicePerMonth > 0 && totalDebt > 0 ? Math.ceil(totalDebt / servicePerMonth) : null;
  const payoffDate =
    payoffMonths !== null && payoffMonths < 1200
      ? new Date(now.getTime() + payoffMonths * 30.44 * 86_400_000).toISOString()
      : null;

  // ── Recurring ──

  const charges = detectRecurring(
    rows.map((r) => ({ tx: r.tx, scope: r.scope, isLiability: r.isLiability })),
    now,
  );
  const recurringMonthly = charges.reduce((t, c) => t + c.monthlyEquivalent, 0);
  const recurringDebt = charges.filter((c) => c.isDebtService).reduce((t, c) => t + c.monthlyEquivalent, 0);

  // ── Ratios ──

  const annualIncome = incomePerMonth * 12;

  return {
    currency,
    lookbackDays,
    observedDays: round2(observedDays),
    monthsObserved: round2(monthsObserved),
    months,
    income: {
      total: round2(income),
      perMonth: incomePerMonth,
      grossCredits: round2(grossCredits),
      transactions: incomeCount,
    },
    spending: {
      total: round2(spending),
      perMonth: spendingPerMonth,
      grossDebits: round2(grossDebits),
      refunds: round2(refunds),
      transactions: spendingCount,
    },
    net: {
      total: round2(netTotal),
      perMonth: perMonth(netTotal),
      savingsRate: income > 0 ? round2(netTotal / income) : null,
    },
    debt: {
      total: round2(totalDebt),
      revolving: round2(revolving),
      instalment: round2(instalment),
      accounts: debtAccounts,
      servicePerMonth,
      payoffMonths,
      payoffDate,
    },
    ratios: {
      debtToIncome: annualIncome > 0 ? round2(totalDebt / annualIncome) : null,
      debtServiceRatio: incomePerMonth > 0 ? round2(servicePerMonth / incomePerMonth) : null,
      monthsOfCover: spendingPerMonth > 0 ? round2(liquidAssets / spendingPerMonth) : null,
      creditUtilisation: cardLimits > 0 ? round2(cardBalances / cardLimits) : null,
    },
    recurring: {
      charges,
      monthlyTotal: round2(recurringMonthly),
      monthlyDebtService: round2(recurringDebt),
    },
    scopes: [...scopeMap.values()].sort((a, b) => b.assets + b.debt - (a.assets + a.debt)),
    confidence: {
      uncategorisedShare: rows.length > 0 ? round2(uncategorised / rows.length) : 0,
      transactions: rows.length,
      noLiabilityAccounts: liabilityAccounts === 0,
    },
  };
}
