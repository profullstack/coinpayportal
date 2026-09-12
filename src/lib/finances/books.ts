import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { listAccounts, type AccountView } from './summary';
import { categorizeTransaction, type SpendCategory } from './classify';
import { defaultTaxCategory, isTaxCategory, taxCategoryLabel, EXCLUDED_TAX_CATEGORIES, INCOME_TAX_CATEGORIES, type TaxCategory } from './tax';
import { parseExactAmount, sumAmounts, isNegativeAmount, negateAmount, formatFixed, displayDecimalsFor, type ExactAmount } from './decimal';
import { csvText, escapeHtml, GENERATED_BY_NOTICE } from './render';
import { audit } from './audit';

/**
 * The books: every transaction gets a category, a tax category and a
 * scope, from the best source available, and a person confirms it.
 *
 *   rule   — a merchant rule ("Porkbun.com" is always software_subscriptions)
 *   model  — a language-model suggestion, when one is configured
 *   auto   — the keyword/MCC heuristics in classify.ts
 *   user   — confirmed in the review queue; never re-derived
 *
 * Suggestions land in `suggested_*` and are copied into the live columns
 * only when nothing better is there. Confirming a row can also create a
 * rule from its payee, which is how one review becomes every future sync
 * agreeing with it.
 */

export const SPEND_CATEGORIES: SpendCategory[] = [
  'income', 'transfer', 'payment', 'fees', 'groceries', 'dining', 'transport', 'fuel', 'travel',
  'shopping', 'utilities', 'software', 'advertising', 'health', 'entertainment', 'insurance', 'taxes', 'cash', 'other',
];

export function isSpendCategory(value: unknown): value is SpendCategory {
  return typeof value === 'string' && (SPEND_CATEGORIES as string[]).includes(value);
}

/** Confidence at or above which a suggestion is not queued for review. */
export const AUTO_ACCEPT_CONFIDENCE = 0.9;

export interface CategoryRule {
  id: string;
  merchant_id: string;
  match_field: 'payee' | 'description';
  match_type: 'exact' | 'contains';
  pattern: string;
  category: string;
  tax_category: string | null;
  scope: 'business' | 'personal' | null;
  hits: number;
  active: boolean;
  created_at: string;
}

export class BooksError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Lower-case, whitespace-collapsed text for rule matching. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface Suggestion {
  category: SpendCategory | null;
  taxCategory: TaxCategory;
  scope: 'business' | 'personal';
  confidence: number;
  source: 'rule' | 'auto' | 'model';
  ruleId?: string;
}

/** First matching rule, exact payee first, then contains, then description. */
export function matchRule(
  rules: CategoryRule[],
  tx: { payee: string | null; description: string | null },
): CategoryRule | null {
  const payee = normalizeText(tx.payee);
  const description = normalizeText(tx.description);
  const order: Array<[CategoryRule['match_field'], CategoryRule['match_type']]> = [
    ['payee', 'exact'], ['payee', 'contains'], ['description', 'exact'], ['description', 'contains'],
  ];
  for (const [field, type] of order) {
    const haystack = field === 'payee' ? payee : description;
    if (!haystack) continue;
    for (const rule of rules) {
      if (!rule.active || rule.match_field !== field || rule.match_type !== type) continue;
      if (type === 'exact' ? haystack === rule.pattern : haystack.includes(rule.pattern)) return rule;
    }
  }
  return null;
}

/** Pure: what the rules and heuristics say about one row. */
export function suggestFor(
  tx: { payee: string | null; description: string | null; memo: string | null; mcc: string | null; amount: ExactAmount },
  accountScope: 'business' | 'personal',
  rules: CategoryRule[],
): Suggestion {
  const credit = !isNegativeAmount(tx.amount);
  const rule = matchRule(rules, tx);
  if (rule) {
    const scope = rule.scope ?? accountScope;
    const category = isSpendCategory(rule.category) ? rule.category : null;
    return {
      category,
      taxCategory: isTaxCategory(rule.tax_category) ? rule.tax_category : defaultTaxCategory(category, scope, credit),
      scope,
      confidence: 0.95,
      source: 'rule',
      ruleId: rule.id,
    };
  }
  const category = categorizeTransaction({
    description: tx.description,
    payee: tx.payee,
    memo: tx.memo,
    mcc: tx.mcc,
    amount: Number(tx.amount),
  });
  const confidence = category === null ? 0 : tx.mcc ? 0.8 : category === 'transfer' || category === 'payment' || category === 'advertising' || category === 'software' ? 0.75 : 0.6;
  return {
    category,
    taxCategory: defaultTaxCategory(category, accountScope, credit),
    scope: accountScope,
    confidence,
    source: 'auto',
  };
}

export async function listRules(merchantId: string): Promise<CategoryRule[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_category_rules')
    .select('id, merchant_id, match_field, match_type, pattern, category, tax_category, scope, hits, active, created_at')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read category rules: ${error.message}`);
  return (data ?? []) as CategoryRule[];
}

export async function createRule(
  merchantId: string,
  input: { matchField: 'payee' | 'description'; matchType: 'exact' | 'contains'; pattern: string; category: string; taxCategory?: string | null; scope?: 'business' | 'personal' | null; fromTransactionId?: string | null },
): Promise<CategoryRule> {
  const pattern = normalizeText(input.pattern);
  if (!pattern) throw new BooksError('invalid_request', 'A rule needs a pattern', 400);
  if (!isSpendCategory(input.category)) throw new BooksError('invalid_request', 'Unknown category', 400);
  if (input.taxCategory && !isTaxCategory(input.taxCategory)) throw new BooksError('invalid_request', 'Unknown tax category', 400);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_category_rules')
    .upsert(
      {
        merchant_id: merchantId,
        match_field: input.matchField,
        match_type: input.matchType,
        pattern,
        category: input.category,
        tax_category: input.taxCategory ?? null,
        scope: input.scope ?? null,
        created_from_transaction_id: input.fromTransactionId ?? null,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'merchant_id,match_field,match_type,pattern' },
    )
    .select('id, merchant_id, match_field, match_type, pattern, category, tax_category, scope, hits, active, created_at')
    .single();
  if (error) throw new Error(`Could not save the rule: ${error.message}`);
  await audit(merchantId, 'books.rule.create', 'rule', (data as CategoryRule).id, { field: input.matchField, type: input.matchType });
  return data as CategoryRule;
}

export async function deleteRule(merchantId: string, ruleId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_category_rules')
    .delete()
    .eq('id', ruleId)
    .eq('merchant_id', merchantId)
    .select('id');
  if (error) throw new Error(`Could not delete the rule: ${error.message}`);
  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------------------
// Queue and review
// ---------------------------------------------------------------------------

export interface BookRow {
  id: string;
  account_id: string;
  posted: string | null;
  transacted_at: string | null;
  amount: ExactAmount;
  description: string | null;
  payee: string | null;
  memo: string | null;
  mcc: string | null;
  pending: boolean;
  category: string | null;
  category_source: string;
  category_confidence: number | null;
  tax_category: string | null;
  scope_override: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  suggested_category: string | null;
  suggested_tax_category: string | null;
  suggested_confidence: number | null;
  suggested_by: string | null;
  account_name: string;
  org_name: string | null;
  currency: string;
  account_scope: string;
  effective_scope: string;
}

const TX_COLUMNS =
  'id, account_id, posted, transacted_at, amount, description, payee, memo, mcc, pending, category, category_source, category_confidence, tax_category, scope_override, reviewed_at, review_note, suggested_category, suggested_tax_category, suggested_confidence, suggested_by';

function decorate(row: Record<string, unknown>, accounts: Map<string, AccountView>): BookRow {
  const account = accounts.get(row.account_id as string);
  const scope = (row.scope_override as string | null) ?? account?.effective_scope ?? 'personal';
  return {
    ...(row as unknown as BookRow),
    amount: parseExactAmount(row.amount) ?? '0',
    account_name: account?.name ?? 'Unknown account',
    org_name: account?.org_name ?? null,
    currency: account?.currency ?? 'USD',
    account_scope: account?.effective_scope ?? 'personal',
    effective_scope: scope,
  };
}

export interface QueueFilters {
  status?: 'unreviewed' | 'reviewed' | 'all';
  accountId?: string | null;
  scope?: 'business' | 'personal' | 'all';
  start?: string | null;
  end?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function listQueue(merchantId: string, filters: QueueFilters = {}): Promise<{ rows: BookRow[]; total: number; unreviewed: number }> {
  const supabase = getSupabaseAdmin();
  const accounts = await listAccounts(merchantId, { includeHidden: true });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let ids = accounts.map((a) => a.id);
  if (filters.accountId) ids = ids.filter((id) => id === filters.accountId);
  if (filters.scope && filters.scope !== 'all') {
    // Account-level scope narrows the query; per-row overrides are applied after.
    ids = accounts.filter((a) => ids.includes(a.id) && a.effective_scope === filters.scope).map((a) => a.id);
  }
  if (ids.length === 0) return { rows: [], total: 0, unreviewed: 0 };

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  let query = supabase
    .from('finance_transactions')
    .select(TX_COLUMNS, { count: 'exact' })
    .in('account_id', ids)
    .eq('pending', false)
    .order('posted', { ascending: false })
    .order('id', { ascending: false });
  if ((filters.status ?? 'unreviewed') === 'unreviewed') query = query.is('reviewed_at', null);
  else if (filters.status === 'reviewed') query = query.not('reviewed_at', 'is', null);
  if (filters.start) query = query.gte('posted', filters.start);
  if (filters.end) query = query.lt('posted', filters.end);
  const search = filters.search?.trim().replace(/[,()*]/g, ' ').trim();
  if (search) query = query.or(`description.ilike.%${search}%,payee.ilike.%${search}%,memo.ilike.%${search}%`);
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`Could not read the books: ${error.message}`);

  const { count: unreviewed } = await supabase
    .from('finance_transactions')
    .select('id', { count: 'exact', head: true })
    .in('account_id', accounts.map((a) => a.id))
    .eq('pending', false)
    .is('reviewed_at', null);

  return {
    rows: (data ?? []).map((r) => decorate(r as Record<string, unknown>, byId)),
    total: count ?? 0,
    unreviewed: unreviewed ?? 0,
  };
}

export interface ReviewInput {
  category?: string | null;
  taxCategory?: string | null;
  scope?: 'business' | 'personal' | null;
  note?: string | null;
  /** Create a payee rule from this row so every future match agrees. */
  createRule?: boolean;
}

/** Confirm one row. Ownership is checked through the account. */
export async function reviewTransaction(merchantId: string, transactionId: string, input: ReviewInput): Promise<BookRow> {
  const supabase = getSupabaseAdmin();
  const accounts = await listAccounts(merchantId, { includeHidden: true });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const { data: existing, error: readError } = await supabase
    .from('finance_transactions')
    .select(TX_COLUMNS)
    .eq('id', transactionId)
    .in('account_id', accounts.map((a) => a.id))
    .maybeSingle();
  if (readError) throw new Error(`Could not read the transaction: ${readError.message}`);
  if (!existing) throw new BooksError('not_found', 'Transaction not found', 404);
  const row = existing as Record<string, unknown>;

  const category = input.category === undefined ? (row.category as string | null) : input.category;
  if (category !== null && !isSpendCategory(category)) throw new BooksError('invalid_request', 'Unknown category', 400);
  const account = byId.get(row.account_id as string);
  const scope = input.scope === undefined ? ((row.scope_override as string | null) ?? account?.effective_scope ?? 'personal') : input.scope ?? account?.effective_scope ?? 'personal';
  const amount = parseExactAmount(row.amount) ?? '0';
  const taxCategory = input.taxCategory === undefined || input.taxCategory === null
    ? (row.tax_category as string | null) ?? defaultTaxCategory(category, scope, !isNegativeAmount(amount))
    : input.taxCategory;
  if (!isTaxCategory(taxCategory)) throw new BooksError('invalid_request', 'Unknown tax category', 400);

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('finance_transactions')
    .update({
      category,
      category_source: 'user',
      category_confidence: 1,
      tax_category: taxCategory,
      scope_override: input.scope === undefined ? (row.scope_override as string | null) : input.scope,
      reviewed_at: now,
      review_note: input.note === undefined ? (row.review_note as string | null) : input.note?.slice(0, 500) ?? null,
      updated_at: now,
    })
    .eq('id', transactionId)
    .select(TX_COLUMNS)
    .single();
  if (error) throw new Error(`Could not save the review: ${error.message}`);

  if (input.createRule && category && normalizeText(row.payee as string | null)) {
    await createRule(merchantId, {
      matchField: 'payee',
      matchType: 'exact',
      pattern: row.payee as string,
      category,
      taxCategory,
      scope: scope as 'business' | 'personal',
      fromTransactionId: transactionId,
    });
  }
  await audit(merchantId, 'books.review', 'transaction', transactionId, { category: category ?? 'none', tax: taxCategory, rule: input.createRule === true });
  return decorate(data as Record<string, unknown>, byId);
}

export async function bulkReview(merchantId: string, ids: string[], input: ReviewInput): Promise<number> {
  let done = 0;
  for (const id of ids.slice(0, 500)) {
    await reviewTransaction(merchantId, id, input);
    done += 1;
  }
  return done;
}

// ---------------------------------------------------------------------------
// Categorisation runs
// ---------------------------------------------------------------------------

export interface CategorizeOutcome {
  examined: number;
  fromRules: number;
  fromModel: number;
  fromHeuristics: number;
  autoAccepted: number;
  queued: number;
}

/**
 * Re-derive suggestions for every unreviewed row (optionally only rows
 * without a category), apply rules, and ask the model about what is left.
 * Reviewed rows are never touched.
 */
export async function runCategorization(
  merchantId: string,
  { useModel = true, onlyUncategorized = false, heartbeat }: { useModel?: boolean; onlyUncategorized?: boolean; heartbeat?: () => Promise<boolean> } = {},
): Promise<CategorizeOutcome> {
  const supabase = getSupabaseAdmin();
  const accounts = await listAccounts(merchantId, { includeHidden: true });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rules = await listRules(merchantId);
  const outcome: CategorizeOutcome = { examined: 0, fromRules: 0, fromModel: 0, fromHeuristics: 0, autoAccepted: 0, queued: 0 };
  if (accounts.length === 0) return outcome;

  const modelCandidates: Array<{ row: Record<string, unknown>; scope: 'business' | 'personal' }> = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase
      .from('finance_transactions')
      .select(TX_COLUMNS)
      .in('account_id', accounts.map((a) => a.id))
      .eq('pending', false)
      .is('reviewed_at', null)
      .order('posted', { ascending: false })
      .range(offset, offset + 499);
    if (onlyUncategorized) query = query.is('category', null);
    const { data, error } = await query;
    if (error) throw new Error(`Could not read transactions: ${error.message}`);
    const page = data ?? [];
    for (const raw of page) {
      const row = raw as Record<string, unknown>;
      outcome.examined += 1;
      const account = byId.get(row.account_id as string);
      const accountScope = ((row.scope_override as string | null) ?? account?.effective_scope ?? 'personal') as 'business' | 'personal';
      const amount = parseExactAmount(row.amount) ?? '0';
      const s = suggestFor(
        { payee: row.payee as string | null, description: row.description as string | null, memo: row.memo as string | null, mcc: row.mcc as string | null, amount },
        accountScope,
        rules,
      );
      if (s.source === 'rule') outcome.fromRules += 1;
      else if (s.category) outcome.fromHeuristics += 1;
      const accept = s.confidence >= AUTO_ACCEPT_CONFIDENCE;
      const patch: Record<string, unknown> = {
        suggested_category: s.category,
        suggested_tax_category: s.taxCategory,
        suggested_confidence: s.confidence,
        suggested_by: s.source,
        updated_at: new Date().toISOString(),
      };
      if (accept || (row.category_source !== 'user' && (row.category === null || row.tax_category === null))) {
        patch.category = s.category ?? (row.category as string | null);
        patch.tax_category = s.taxCategory;
        patch.category_source = s.source;
        patch.category_confidence = s.confidence;
        if (s.source === 'rule' && s.scope !== accountScope) patch.scope_override = s.scope;
      }
      if (accept) outcome.autoAccepted += 1;
      else outcome.queued += 1;
      const { error: upError } = await supabase.from('finance_transactions').update(patch).eq('id', row.id as string);
      if (upError) throw new Error(`Could not update the transaction: ${upError.message}`);
      if (useModel && !accept) modelCandidates.push({ row: { ...row, ...patch }, scope: accountScope });
    }
    if (heartbeat && !(await heartbeat())) return outcome;
    if (page.length < 500) break;
  }

  if (useModel && modelCandidates.length > 0) {
    const { categorizeWithModel, isModelCategorizationEnabled } = await import('./categorize-model');
    if (isModelCategorizationEnabled()) {
      for (let i = 0; i < modelCandidates.length; i += 200) {
        const chunk = modelCandidates.slice(i, i + 200);
        const suggestions = await categorizeWithModel(
          chunk.map(({ row, scope }) => {
            const account = byId.get(row.account_id as string);
            return {
              id: row.id as string,
              payee: row.payee as string | null,
              description: row.description as string | null,
              memo: row.memo as string | null,
              amount: parseExactAmount(row.amount) ?? '0',
              currency: account?.currency ?? 'USD',
              accountName: account?.name ?? '',
              accountKind: account?.effective_kind ?? 'unknown',
              accountScope: scope,
            };
          }),
        );
        for (const [id, s] of suggestions) {
          outcome.fromModel += 1;
          const accept = s.confidence >= AUTO_ACCEPT_CONFIDENCE;
          const patch: Record<string, unknown> = {
            suggested_category: s.category,
            suggested_tax_category: s.taxCategory,
            suggested_confidence: s.confidence,
            suggested_by: 'model',
            review_note: s.reason,
            updated_at: new Date().toISOString(),
          };
          if (accept) {
            patch.category = s.category;
            patch.tax_category = s.taxCategory;
            patch.category_source = 'model';
            patch.category_confidence = s.confidence;
            outcome.autoAccepted += 1;
            outcome.queued -= 1;
          }
          await supabase.from('finance_transactions').update(patch).eq('id', id);
        }
        if (heartbeat && !(await heartbeat())) break;
      }
    }
  }
  await audit(merchantId, 'books.categorize', 'merchant', merchantId, { ...outcome });
  return outcome;
}

// ---------------------------------------------------------------------------
// Tax summary and export
// ---------------------------------------------------------------------------

export interface BooksSummaryLine {
  taxCategory: TaxCategory | 'uncategorized';
  label: string;
  currency: string;
  total: ExactAmount;
  rows: number;
  excluded: boolean;
  income: boolean;
}

export interface BooksSummary {
  start: string;
  end: string;
  scope: 'business' | 'personal' | 'all';
  lines: BooksSummaryLine[];
  totals: Array<{ currency: string; income: ExactAmount; expenses: ExactAmount; net: ExactAmount; excluded: ExactAmount }>;
  rows: number;
  unreviewed: number;
  uncategorized: number;
  transactions: BookRow[];
  notice: string;
}

/** All posted rows in [start, end) for the accounts in scope, paged fully. */
async function rowsForPeriod(merchantId: string, start: string, end: string, scope: 'business' | 'personal' | 'all'): Promise<BookRow[]> {
  const supabase = getSupabaseAdmin();
  const accounts = await listAccounts(merchantId, { includeHidden: true });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return [];
  const out: BookRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('finance_transactions')
      .select(TX_COLUMNS)
      .in('account_id', ids)
      .eq('pending', false)
      .gte('posted', start)
      .lt('posted', end)
      .order('posted', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Could not read the books: ${error.message}`);
    const page = (data ?? []).map((r) => decorate(r as Record<string, unknown>, byId));
    out.push(...page.filter((r) => scope === 'all' || r.effective_scope === scope));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export async function booksSummary(merchantId: string, params: { start: string; end: string; scope?: 'business' | 'personal' | 'all' }): Promise<BooksSummary> {
  const scope = params.scope ?? 'business';
  const rows = await rowsForPeriod(merchantId, params.start, params.end, scope);
  const buckets = new Map<string, { taxCategory: TaxCategory | 'uncategorized'; currency: string; amounts: ExactAmount[] }>();
  let unreviewed = 0;
  let uncategorized = 0;
  for (const r of rows) {
    const tax: TaxCategory | 'uncategorized' = isTaxCategory(r.tax_category) ? r.tax_category : 'uncategorized';
    if (!r.reviewed_at) unreviewed += 1;
    if (tax === 'uncategorized') uncategorized += 1;
    const key = `${tax}::${r.currency}`;
    const bucket = buckets.get(key) ?? { taxCategory: tax, currency: r.currency, amounts: [] };
    bucket.amounts.push(r.amount);
    buckets.set(key, bucket);
  }
  const lines: BooksSummaryLine[] = [...buckets.values()]
    .map((b) => {
      const income = INCOME_TAX_CATEGORIES.has(b.taxCategory as TaxCategory);
      const excluded = EXCLUDED_TAX_CATEGORIES.has(b.taxCategory as TaxCategory);
      const raw = sumAmounts(b.amounts);
      // Expenses are shown as positive magnitudes; income as positive credits.
      const total = income || excluded ? raw : isNegativeAmount(raw) ? negateAmount(raw) : raw;
      return { taxCategory: b.taxCategory, label: taxCategoryLabel(b.taxCategory), currency: b.currency, total, rows: b.amounts.length, excluded, income };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency) || Number(b.income) - Number(a.income) || a.label.localeCompare(b.label));

  const currencies = [...new Set(lines.map((l) => l.currency))].sort();
  const totals = currencies.map((currency) => {
    const inc = lines.filter((l) => l.currency === currency && l.income).map((l) => l.total);
    const exp = lines.filter((l) => l.currency === currency && !l.income && !l.excluded && l.taxCategory !== 'uncategorized').map((l) => l.total);
    const exc = lines.filter((l) => l.currency === currency && l.excluded).map((l) => l.total);
    const income = sumAmounts(inc);
    const expenses = sumAmounts(exp);
    return { currency, income, expenses, net: sumAmounts([income, negateAmount(expenses)]), excluded: sumAmounts(exc) };
  });

  return {
    start: params.start,
    end: params.end,
    scope,
    lines,
    totals,
    rows: rows.length,
    unreviewed,
    uncategorized,
    transactions: rows,
    notice: `${GENERATED_BY_NOTICE} Tax categories are a bookkeeping mapping prepared for your accountant, not tax advice; ${unreviewed} of ${rows.length} rows are not yet reviewed.`,
  };
}

export function renderBooksCsv(s: BooksSummary): string {
  const lines: string[] = [];
  lines.push(`# ${s.notice}`);
  lines.push(`# Period ${s.start} to ${s.end} (exclusive), scope ${s.scope}`);
  lines.push('section,tax_category,label,currency,total,rows,excluded,income');
  for (const l of s.lines) {
    lines.push(['summary', l.taxCategory, csvText(l.label), l.currency, l.total, String(l.rows), String(l.excluded), String(l.income)].join(','));
  }
  lines.push('');
  lines.push('section,posted,account,institution,currency,amount,payee,description,memo,category,tax_category,scope,reviewed,source,confidence,note,transaction_id');
  for (const r of s.transactions) {
    lines.push([
      'ledger', csvText(r.posted), csvText(r.account_name), csvText(r.org_name), r.currency, r.amount, csvText(r.payee), csvText(r.description), csvText(r.memo),
      csvText(r.category), csvText(r.tax_category), r.effective_scope, r.reviewed_at ? 'yes' : 'no', r.category_source,
      r.category_confidence === null ? '' : String(r.category_confidence), csvText(r.review_note), r.id,
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function renderBooksHtml(s: BooksSummary): string {
  const money = (v: ExactAmount, c: string) => formatFixed(v, displayDecimalsFor(c));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Books ${escapeHtml(s.start)} to ${escapeHtml(s.end)}</title>
<style>body{font:13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #e5e5e5;padding:4px 6px;text-align:left}th{background:#f5f5f5}.num{text-align:right;white-space:nowrap}.notice{border:1px solid #c9a227;background:#fff8dc;padding:8px;margin:12px 0}</style></head><body>
<h1>Books: ${escapeHtml(s.start)} to ${escapeHtml(s.end)} (exclusive), ${escapeHtml(s.scope)}</h1>
<div class="notice">${escapeHtml(s.notice)}</div>
<h2>Totals</h2><table><thead><tr><th>Currency</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th><th class="num">Excluded (transfers, personal, tax payments)</th></tr></thead><tbody>
${s.totals.map((t) => `<tr><td>${escapeHtml(t.currency)}</td><td class="num">${money(t.income, t.currency)}</td><td class="num">${money(t.expenses, t.currency)}</td><td class="num">${money(t.net, t.currency)}</td><td class="num">${money(t.excluded, t.currency)}</td></tr>`).join('')}
</tbody></table>
<h2>By tax category</h2><table><thead><tr><th>Category</th><th>Currency</th><th class="num">Total</th><th class="num">Rows</th></tr></thead><tbody>
${s.lines.map((l) => `<tr><td>${escapeHtml(l.label)}${l.excluded ? ' (excluded)' : ''}</td><td>${escapeHtml(l.currency)}</td><td class="num">${money(l.total, l.currency)}</td><td class="num">${l.rows}</td></tr>`).join('')}
</tbody></table>
<h2>Ledger (${s.transactions.length})</h2><table><thead><tr><th>Date</th><th>Account</th><th>Payee / description</th><th>Category</th><th>Tax category</th><th>Scope</th><th>Reviewed</th><th class="num">Amount</th></tr></thead><tbody>
${s.transactions.map((r) => `<tr><td>${escapeHtml((r.posted ?? '').slice(0, 10))}</td><td>${escapeHtml(r.account_name)}</td><td>${escapeHtml(r.payee ?? r.description ?? '')}${r.payee && r.description ? `<br><small>${escapeHtml(r.description)}</small>` : ''}</td><td>${escapeHtml(r.category ?? '')}</td><td>${escapeHtml(taxCategoryLabel(r.tax_category))}</td><td>${escapeHtml(r.effective_scope)}</td><td>${r.reviewed_at ? 'yes' : 'no'}</td><td class="num">${money(r.amount, r.currency)}</td></tr>`).join('')}
</tbody></table></body></html>`;
}

export async function renderBooksPdf(s: BooksSummary): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const money = (v: ExactAmount, c: string) => formatFixed(v, displayDecimalsFor(c));
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  const margin = 40;
  doc.setFontSize(15);
  doc.text(`Books: ${s.start} to ${s.end} (exclusive), ${s.scope}`, margin, margin);
  doc.setFontSize(8);
  doc.setTextColor(80);
  const wrapped = doc.splitTextToSize(s.notice, 612 - margin * 2) as string[];
  doc.text(wrapped, margin, margin + 16);
  doc.setTextColor(0);
  autoTable(doc, {
    startY: margin + 16 + 10 * wrapped.length + 8,
    head: [['Currency', 'Income', 'Expenses', 'Net', 'Excluded']],
    body: s.totals.map((t) => [t.currency, money(t.income, t.currency), money(t.expenses, t.currency), money(t.net, t.currency), money(t.excluded, t.currency)]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [235, 235, 235], textColor: 20 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: margin, right: margin },
  });
  const y1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  autoTable(doc, {
    startY: y1,
    head: [['Tax category', 'Currency', 'Total', 'Rows']],
    body: s.lines.map((l) => [`${l.label}${l.excluded ? ' (excluded)' : ''}`, l.currency, money(l.total, l.currency), String(l.rows)]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [235, 235, 235], textColor: 20 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: margin, right: margin },
  });
  const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  autoTable(doc, {
    startY: y2,
    head: [['Date', 'Account', 'Payee / description', 'Tax category', 'Scope', 'Rev.', 'Amount']],
    body: s.transactions.map((r) => [
      (r.posted ?? '').slice(0, 10), r.account_name, [r.payee, r.description].filter(Boolean).join(' / '), taxCategoryLabel(r.tax_category), r.effective_scope, r.reviewed_at ? 'yes' : 'no', money(r.amount, r.currency),
    ]),
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' }, headStyles: { fillColor: [235, 235, 235], textColor: 20 },
    columnStyles: { 0: { cellWidth: 56 }, 1: { cellWidth: 80 }, 5: { cellWidth: 28 }, 6: { halign: 'right', cellWidth: 62 } },
    margin: { left: margin, right: margin }, showHead: 'everyPage',
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`Prepared from CoinPay books; bookkeeping mapping, not tax advice. Page ${i} of ${pages}`, margin, 792 - 20);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

export function toPublicRow(r: BookRow) {
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name,
    orgName: r.org_name,
    currency: r.currency,
    posted: r.posted,
    amount: r.amount,
    payee: r.payee,
    description: r.description,
    memo: r.memo,
    category: r.category,
    categorySource: r.category_source,
    categoryConfidence: r.category_confidence,
    taxCategory: r.tax_category,
    taxCategoryLabel: taxCategoryLabel(r.tax_category),
    scope: r.effective_scope,
    scopeOverride: r.scope_override,
    accountScope: r.account_scope,
    reviewedAt: r.reviewed_at,
    note: r.review_note,
    suggestion: r.suggested_category || r.suggested_tax_category
      ? { category: r.suggested_category, taxCategory: r.suggested_tax_category, confidence: r.suggested_confidence, by: r.suggested_by }
      : null,
  };
}
