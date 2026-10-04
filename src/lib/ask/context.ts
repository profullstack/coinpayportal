import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccessibleBusinessRoles, resolveOrgRole } from '@/lib/auth/authz';
import type { Role } from '@/lib/auth/permissions';
import { can } from '@/lib/auth/permissions';
import { listFinanceOwners, resolveFinanceRole } from '@/lib/finances/access';
import { listAccounts, listTransactions } from '@/lib/finances/summary';
import { booksSummary } from '@/lib/finances/books';

/**
 * The data "Ask Your Data" answers from: a compact JSON snapshot of exactly what
 * the asker could already open in the app, never more.
 *
 *  - Businesses: those `getAccessibleBusinessRoles` returns (owned, business member,
 *    org member), or for an org question only that org's businesses.
 *  - Payments and invoices: aggregates for those businesses over the window.
 *  - Finances: the asker's own books, plus books an org owner shared with them
 *    (finance_access). For an org question, only that org owner's books.
 *  - Platform totals: only for platform admins asking on /admin.
 *
 * Authorization is the same code the pages use, so a question can never reach
 * data a click could not.
 */

export type AskScope =
  | { kind: 'me' }
  | { kind: 'org'; orgId: string }
  | { kind: 'platform' };

const WINDOW_DAYS = 90;
const MAX_BUSINESSES = 50;
const MAX_TRANSACTIONS = 300;
const SETTLED = ['confirmed', 'forwarded'];

type BusinessRow = { id: string; name: string | null; organization_id: string | null };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function businessesFor(
  supabase: SupabaseClient,
  actorId: string,
  scope: AskScope,
): Promise<Array<BusinessRow & { role: Role }>> {
  if (scope.kind === 'org') {
    const role = await resolveOrgRole(supabase, actorId, scope.orgId);
    if (!role) return [];
    const { data } = await supabase
      .from('businesses')
      .select('id, name, organization_id')
      .eq('organization_id', scope.orgId)
      .limit(MAX_BUSINESSES);
    return ((data ?? []) as BusinessRow[]).map((b) => ({ ...b, role }));
  }
  const roles = await getAccessibleBusinessRoles(supabase, actorId);
  const ids = [...roles.keys()].slice(0, MAX_BUSINESSES);
  if (ids.length === 0) return [];
  const { data } = await supabase.from('businesses').select('id, name, organization_id').in('id', ids);
  return ((data ?? []) as BusinessRow[]).map((b) => ({ ...b, role: roles.get(b.id) as Role }));
}

async function paymentStats(supabase: SupabaseClient, businessIds: string[], since: string) {
  if (businessIds.length === 0) return [];
  const { data, error } = await supabase
    .from('payments')
    .select('business_id, amount, status, blockchain, created_at')
    .in('business_id', businessIds)
    .gte('created_at', since)
    .limit(10000);
  if (error) return [];
  const byBiz = new Map<string, { payments: number; settled: number; settledUsd: number; byChain: Record<string, number>; byStatus: Record<string, number>; byMonth: Record<string, number> }>();
  for (const p of (data ?? []) as Array<{ business_id: string; amount: number | string | null; status: string; blockchain: string | null; created_at: string }>) {
    const s = byBiz.get(p.business_id) ?? { payments: 0, settled: 0, settledUsd: 0, byChain: {}, byStatus: {}, byMonth: {} };
    s.payments += 1;
    s.byStatus[p.status] = (s.byStatus[p.status] ?? 0) + 1;
    if (SETTLED.includes(p.status)) {
      const usd = Number(p.amount) || 0;
      s.settled += 1;
      s.settledUsd += usd;
      const chain = p.blockchain ?? 'unknown';
      s.byChain[chain] = round2((s.byChain[chain] ?? 0) + usd);
      const month = p.created_at.slice(0, 7);
      s.byMonth[month] = round2((s.byMonth[month] ?? 0) + usd);
    }
    byBiz.set(p.business_id, s);
  }
  return [...byBiz.entries()].map(([businessId, s]) => ({
    businessId,
    payments: s.payments,
    settled: s.settled,
    settledUsd: round2(s.settledUsd),
    settledUsdByChain: s.byChain,
    settledUsdByMonth: s.byMonth,
    countByStatus: s.byStatus,
  }));
}

async function invoiceStats(supabase: SupabaseClient, businessIds: string[], since: string) {
  if (businessIds.length === 0) return [];
  const { data, error } = await supabase
    .from('invoices')
    .select('business_id, amount, currency, status, created_at')
    .in('business_id', businessIds)
    .gte('created_at', since)
    .limit(10000);
  if (error) return [];
  const byBiz = new Map<string, { count: number; byStatus: Record<string, { count: number; usd: number }> }>();
  for (const i of (data ?? []) as Array<{ business_id: string; amount: number | string | null; currency: string | null; status: string }>) {
    const s = byBiz.get(i.business_id) ?? { count: 0, byStatus: {} };
    s.count += 1;
    const b = s.byStatus[i.status] ?? { count: 0, usd: 0 };
    b.count += 1;
    // Only USD invoices are summable; a few are priced in crypto units.
    if ((i.currency ?? 'USD') === 'USD') b.usd = round2(b.usd + (Number(i.amount) || 0));
    s.byStatus[i.status] = b;
    byBiz.set(i.business_id, s);
  }
  return [...byBiz.entries()].map(([businessId, s]) => ({ businessId, invoices: s.count, byStatus: s.byStatus }));
}

async function financeSnapshot(ownerId: string, label: string, role: Role) {
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const start = since.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  try {
    const [accounts, books, txns] = await Promise.all([
      listAccounts(ownerId),
      booksSummary(ownerId, { start, end, scope: 'all' }),
      listTransactions(ownerId, { startDate: since, limit: MAX_TRANSACTIONS }),
    ]);
    return {
      owner: label,
      yourAccess: role,
      accounts: accounts.map((a) => ({
        institution: a.org_name,
        name: a.name,
        kind: a.effective_kind,
        scope: a.effective_scope,
        currency: a.currency,
        // As a person would state it; read with isDebt, never summed alone.
        balance: a.display_balance,
        isDebt: a.is_liability,
        asOf: a.balance_date,
      })),
      books: {
        period: { start: books.start, end: books.end },
        totals: books.totals,
        byCategory: books.lines.map((l) => ({ category: l.label, currency: l.currency, total: l.total, rows: l.rows, income: l.income })),
        unreviewed: books.unreviewed,
        uncategorized: books.uncategorized,
      },
      recentTransactions: txns.rows.map((t) => ({
        date: t.posted,
        amount: t.amount,
        payee: t.payee,
        description: t.description,
        category: t.category,
        pending: t.pending,
      })),
      recentTransactionsTotal: txns.total,
    };
  } catch (err) {
    return { owner: label, yourAccess: role, error: err instanceof Error ? err.message : 'Could not load finances' };
  }
}

async function platformTotals(supabase: SupabaseClient, since: string) {
  const [merchants, businesses, payments] = await Promise.all([
    supabase.from('merchants').select('id', { count: 'exact', head: true }),
    supabase.from('businesses').select('id', { count: 'exact', head: true }),
    supabase.from('payments').select('amount, status').gte('created_at', since).in('status', SETTLED).limit(50000),
  ]);
  const settledUsd = ((payments.data ?? []) as Array<{ amount: number | string | null }>).reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0,
  );
  return {
    merchants: merchants.count ?? null,
    businesses: businesses.count ?? null,
    settledPaymentsInWindow: payments.data?.length ?? 0,
    settledUsdInWindow: round2(settledUsd),
  };
}

export async function buildAskContext(
  supabase: SupabaseClient,
  actor: { id: string; email: string },
  scope: AskScope,
): Promise<Record<string, unknown>> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const businesses = await businessesFor(supabase, actor.id, scope);
  const visible = businesses.filter((b) => can(b.role, 'business.read'));
  const ids = visible.map((b) => b.id);

  const [payments, invoices] = await Promise.all([
    paymentStats(supabase, ids, since),
    invoiceStats(supabase, ids, since),
  ]);

  // Whose books to include.
  let owners: Array<{ ownerId: string; label: string; role: Role }> = [];
  if (scope.kind === 'org') {
    const { data: org } = await supabase
      .from('organizations')
      .select('owner_merchant_id, name')
      .eq('id', scope.orgId)
      .maybeSingle();
    if (org?.owner_merchant_id) {
      const role = await resolveFinanceRole(supabase, actor.id, org.owner_merchant_id);
      if (role) owners = [{ ownerId: org.owner_merchant_id, label: `owner of ${org.name ?? 'the organization'}`, role }];
    }
  } else {
    const list = await listFinanceOwners(supabase, actor.id, actor.email);
    owners = list.map((o) => ({
      ownerId: o.ownerId,
      label: o.self ? 'you' : o.name || o.email || 'an organization owner',
      role: o.role,
    }));
  }
  const finances = await Promise.all(owners.map((o) => financeSnapshot(o.ownerId, o.label, o.role)));

  return {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    scope: scope.kind,
    businesses: visible.map((b) => ({ id: b.id, name: b.name, yourRole: b.role, organizationId: b.organization_id })),
    payments,
    invoices,
    finances,
    ...(scope.kind === 'platform' ? { platform: await platformTotals(supabase, since) } : {}),
    notes: [
      'payments.amount is USD; "settled" means status confirmed or forwarded.',
      'Invoice USD totals include only invoices priced in USD.',
      'Finance amounts are strings in the account currency; negative is money out.',
    ],
  };
}
