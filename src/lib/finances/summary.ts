import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { effectiveKind, isLiabilityKind, type AccountKind } from './classify';

/**
 * Reading the finance tables.
 *
 * Two rules shape everything here.
 *
 * **Totals are keyed by currency, never summed across one.** Every account is
 * USD today, but a single foreign account would silently corrupt a bare
 * `sum(balance)` and nothing would look wrong. Grouping by currency costs one
 * map and makes that impossible.
 *
 * **Liability sign is normalised once, at the boundary.** SimpleFIN reports a
 * card you owe $1,500 on as `-1500.00`. That sign is preserved in the database
 * (it is the only account-type signal the protocol gives) but every figure
 * leaving this module is stated the way a person would: `liabilities` is a
 * positive amount owed, and `net` is assets minus liabilities.
 */

/** Supabase caps a single select at 1000 rows; anything unbounded pages. */
const PAGE_SIZE = 1000;

/** Ceiling on rows pulled into memory for an aggregate. */
const MAX_AGGREGATE_ROWS = 50_000;

export interface FinanceAccount {
  id: string;
  connection_id: string;
  external_id: string;
  org_name: string | null;
  org_domain: string | null;
  name: string;
  currency: string;
  balance: number | null;
  available_balance: number | null;
  balance_date: string | null;
  kind: AccountKind;
  kind_override: string | null;
  is_hidden: boolean;
  last_seen_at: string;
}

export interface FinanceTransaction {
  id: string;
  account_id: string;
  posted: string;
  transacted_at: string | null;
  amount: number;
  description: string | null;
  payee: string | null;
  memo: string | null;
  mcc: string | null;
  pending: boolean;
  category: string | null;
}

/** An account as the UI consumes it: kind resolved, liability sign flipped. */
export interface AccountView extends FinanceAccount {
  /** `kind_override` when set, otherwise the derived `kind`. */
  effective_kind: AccountKind;
  /** True when this account's balance is a debt. */
  is_liability: boolean;
  /**
   * The balance as a person would state it: positive for money held, positive
   * for money owed. Read alongside `is_liability` — never summed on its own.
   */
  display_balance: number | null;
}

export interface CurrencyTotals {
  currency: string;
  assets: number;
  liabilities: number;
  net: number;
  accounts: number;
}

export interface CategoryTotal {
  category: string | null;
  spent: number;
  received: number;
  count: number;
}

export interface InstitutionTotal {
  org: string;
  currency: string;
  assets: number;
  liabilities: number;
  accounts: number;
}

export interface FinanceSummary {
  /** Window in days that the cashflow and category figures cover. */
  windowDays: number;
  totals: CurrencyTotals[];
  /** The currency holding the most accounts — what the headline figures use. */
  primaryCurrency: string | null;
  byKind: Array<{ kind: AccountKind; currency: string; total: number; accounts: number }>;
  byInstitution: InstitutionTotal[];
  cashflow: {
    currency: string | null;
    moneyIn: number;
    moneyOut: number;
    net: number;
    transactions: number;
  };
  topCategories: CategoryTotal[];
  accountCount: number;
  hiddenCount: number;
  transactionCount: number;
  oldestTransaction: string | null;
  newestTransaction: string | null;
}

/**
 * Page through a table until it is exhausted or the cap is hit.
 *
 * Without this, every aggregate would silently describe only the first 1000
 * rows — which reads as a working feature right up until the data outgrows it.
 */
async function fetchAllRows<T>(
  build: () => ReturnType<ReturnType<typeof getSupabaseAdmin>['from']>,
  { max = MAX_AGGREGATE_ROWS }: { max?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += PAGE_SIZE) {
    const query = build() as unknown as {
      range: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>;
    };
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Turn a stored row into the shape the UI wants. */
export function toAccountView(row: FinanceAccount): AccountView {
  const kind = effectiveKind(row);
  const liability = isLiabilityKind(kind);
  const balance = row.balance;

  return {
    ...row,
    kind,
    effective_kind: kind,
    is_liability: liability,
    // A liability's stored balance is negative; state it as a positive amount
    // owed. `Math.abs` would also flip a credit *balance* on an overpaid card,
    // so negate rather than abs — an overpaid card correctly shows as owing a
    // negative amount, which is true and visible.
    display_balance: balance === null ? null : liability ? -balance : balance,
  };
}

export async function listAccounts({
  includeHidden = false,
}: { includeHidden?: boolean } = {}): Promise<AccountView[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('finance_accounts')
    .select(
      'id, connection_id, external_id, org_name, org_domain, name, currency, balance, available_balance, balance_date, kind, kind_override, is_hidden, last_seen_at',
    )
    .order('org_name', { ascending: true })
    .order('name', { ascending: true });

  if (!includeHidden) query = query.eq('is_hidden', false);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load accounts: ${error.message}`);

  return (data ?? []).map((row) => toAccountView(row as unknown as FinanceAccount));
}

/**
 * Roll a set of accounts up into the balance sheet.
 *
 * Pure and exported so the sign handling can be tested directly — it is the
 * one piece of arithmetic here where being wrong produces a plausible-looking
 * number rather than an obvious error.
 */
export function aggregateAccounts(accounts: AccountView[]): {
  totals: CurrencyTotals[];
  primaryCurrency: string | null;
  byKind: Array<{ kind: AccountKind; currency: string; total: number; accounts: number }>;
  byInstitution: InstitutionTotal[];
} {
  const totalsByCurrency = new Map<string, CurrencyTotals>();
  const kindTotals = new Map<
    string,
    { kind: AccountKind; currency: string; total: number; accounts: number }
  >();
  const institutionTotals = new Map<string, InstitutionTotal>();

  for (const account of accounts) {
    const currency = account.currency || 'USD';
    const balance = account.balance ?? 0;

    const totals =
      totalsByCurrency.get(currency) ?? { currency, assets: 0, liabilities: 0, net: 0, accounts: 0 };
    totals.accounts += 1;

    // Classify by kind first, and only fall back to the sign of the balance for
    // accounts we could not type. Without that fallback an untyped card would
    // be counted as a negative asset — which nets out to the same figure but
    // understates both assets and debt, and those are the two numbers anyone
    // actually reads.
    const isDebt = account.is_liability || (account.effective_kind === 'unknown' && balance < 0);

    if (isDebt) totals.liabilities += -balance;
    else totals.assets += balance;

    totals.net = totals.assets - totals.liabilities;
    totalsByCurrency.set(currency, totals);

    const kindKey = `${account.effective_kind}::${currency}`;
    const kindEntry =
      kindTotals.get(kindKey) ?? { kind: account.effective_kind, currency, total: 0, accounts: 0 };
    kindEntry.total += isDebt ? -balance : balance;
    kindEntry.accounts += 1;
    kindTotals.set(kindKey, kindEntry);

    const org = account.org_name ?? 'Unknown institution';
    const orgKey = `${org}::${currency}`;
    const orgEntry =
      institutionTotals.get(orgKey) ?? { org, currency, assets: 0, liabilities: 0, accounts: 0 };
    if (isDebt) orgEntry.liabilities += -balance;
    else orgEntry.assets += balance;
    orgEntry.accounts += 1;
    institutionTotals.set(orgKey, orgEntry);
  }

  const totals = [...totalsByCurrency.values()].sort((a, b) => b.accounts - a.accounts);

  return {
    totals,
    primaryCurrency: totals[0]?.currency ?? null,
    byKind: [...kindTotals.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    byInstitution: [...institutionTotals.values()].sort(
      (a, b) => b.assets + b.liabilities - (a.assets + a.liabilities),
    ),
  };
}

export interface TransactionFilters {
  accountId?: string | null;
  search?: string | null;
  category?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  includePending?: boolean;
  includeHiddenAccounts?: boolean;
  limit?: number;
  offset?: number;
}

export interface TransactionPage {
  rows: Array<FinanceTransaction & { account_name: string; org_name: string | null; currency: string }>;
  total: number;
  limit: number;
  offset: number;
}

/**
 * One page of the ledger, newest first, with the account joined on.
 *
 * Hidden accounts are excluded by filtering on their ids rather than through a
 * join, because PostgREST cannot filter a parent by an embedded child's column
 * without changing the row shape.
 */
export async function listTransactions(filters: TransactionFilters = {}): Promise<TransactionPage> {
  const supabase = getSupabaseAdmin();

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const accounts = await listAccounts({ includeHidden: filters.includeHiddenAccounts ?? false });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const visibleIds = filters.accountId
    ? accounts.filter((a) => a.id === filters.accountId).map((a) => a.id)
    : accounts.map((a) => a.id);

  if (visibleIds.length === 0) {
    return { rows: [], total: 0, limit, offset };
  }

  let query = supabase
    .from('finance_transactions')
    .select(
      'id, account_id, posted, transacted_at, amount, description, payee, memo, mcc, pending, category',
      { count: 'exact' },
    )
    .in('account_id', visibleIds)
    .order('posted', { ascending: false })
    .order('id', { ascending: false });

  if (filters.startDate) query = query.gte('posted', filters.startDate.toISOString());
  if (filters.endDate) query = query.lte('posted', filters.endDate.toISOString());
  if (filters.includePending === false) query = query.eq('pending', false);
  if (filters.category === 'uncategorised') query = query.is('category', null);
  else if (filters.category) query = query.eq('category', filters.category);

  const search = filters.search?.trim();
  if (search) {
    // Commas and parentheses are PostgREST `or()` syntax, not text — passing
    // them through unescaped turns a search box into a filter-injection point.
    const safe = search.replace(/[,()*]/g, ' ').trim();
    if (safe) {
      query = query.or(
        `description.ilike.%${safe}%,payee.ilike.%${safe}%,memo.ilike.%${safe}%`,
      );
    }
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`Could not load transactions: ${error.message}`);

  const rows = (data ?? []).map((row) => {
    const tx = row as unknown as FinanceTransaction;
    const account = accountById.get(tx.account_id);
    return {
      ...tx,
      account_name: account?.name ?? 'Unknown account',
      org_name: account?.org_name ?? null,
      currency: account?.currency ?? 'USD',
    };
  });

  return { rows, total: count ?? rows.length, limit, offset };
}

/**
 * The headline figures.
 *
 * @param windowDays how far back cashflow and categories look; balances are
 *        always current, since a balance has no window.
 */
export async function getSummary({
  windowDays = 30,
  includeHidden = false,
}: { windowDays?: number; includeHidden?: boolean } = {}): Promise<FinanceSummary> {
  const supabase = getSupabaseAdmin();
  const days = Math.min(Math.max(Math.floor(windowDays) || 30, 1), 3650);

  const accounts = await listAccounts({ includeHidden });
  const allAccounts = includeHidden ? accounts : await listAccounts({ includeHidden: true });
  const hiddenCount = allAccounts.filter((a) => a.is_hidden).length;

  const { totals, primaryCurrency, byKind, byInstitution } = aggregateAccounts(accounts);

  // --- cashflow and categories ---------------------------------------------
  const since = new Date(Date.now() - days * 86_400_000);
  const visibleIds = accounts.map((a) => a.id);
  const currencyByAccount = new Map(accounts.map((a) => [a.id, a.currency || 'USD']));

  let moneyIn = 0;
  let moneyOut = 0;
  let transactionsInWindow = 0;
  const categoryTotals = new Map<string, CategoryTotal>();

  if (visibleIds.length > 0) {
    const rows = await fetchAllRows<{
      account_id: string;
      amount: number;
      category: string | null;
    }>(() =>
      supabase
        .from('finance_transactions')
        .select('account_id, amount, category')
        .in('account_id', visibleIds)
        .gte('posted', since.toISOString())
        .order('posted', { ascending: false }) as never,
    );

    for (const row of rows) {
      // Only the primary currency contributes to the headline cashflow;
      // mixing currencies into one in/out figure would be meaningless.
      if (primaryCurrency && currencyByAccount.get(row.account_id) !== primaryCurrency) continue;

      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;

      transactionsInWindow += 1;
      if (amount >= 0) moneyIn += amount;
      else moneyOut += -amount;

      const key = row.category ?? '__uncategorised__';
      const entry =
        categoryTotals.get(key) ??
        { category: row.category, spent: 0, received: 0, count: 0 };
      if (amount < 0) entry.spent += -amount;
      else entry.received += amount;
      entry.count += 1;
      categoryTotals.set(key, entry);
    }
  }

  // --- corpus extent --------------------------------------------------------
  let transactionCount = 0;
  let oldestTransaction: string | null = null;
  let newestTransaction: string | null = null;

  if (visibleIds.length > 0) {
    const { count } = await supabase
      .from('finance_transactions')
      .select('id', { count: 'exact', head: true })
      .in('account_id', visibleIds);
    transactionCount = count ?? 0;

    const { data: oldest } = await supabase
      .from('finance_transactions')
      .select('posted')
      .in('account_id', visibleIds)
      .order('posted', { ascending: true })
      .limit(1);
    oldestTransaction = (oldest?.[0]?.posted as string) ?? null;

    const { data: newest } = await supabase
      .from('finance_transactions')
      .select('posted')
      .in('account_id', visibleIds)
      .order('posted', { ascending: false })
      .limit(1);
    newestTransaction = (newest?.[0]?.posted as string) ?? null;
  }

  return {
    windowDays: days,
    totals,
    primaryCurrency,
    byKind,
    byInstitution,
    cashflow: {
      currency: primaryCurrency,
      moneyIn,
      moneyOut,
      net: moneyIn - moneyOut,
      transactions: transactionsInWindow,
    },
    topCategories: [...categoryTotals.values()]
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 12),
    accountCount: accounts.length,
    hiddenCount,
    transactionCount,
    oldestTransaction,
    newestTransaction,
  };
}
