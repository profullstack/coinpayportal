import 'server-only';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../supabase/server';
import { listAccounts, type AccountView } from './summary';
import { localDate } from './periods';
import { audit } from './audit';
import {
  GoalError,
  buildReport,
  goalBreakdown,
  normalizeContribution,
  normalizeGoal,
  progressAt,
  snapshotGoal,
  type Contribution,
  type Goal,
  type GoalInputs,
  type GoalPeriod,
  type GoalReport,
  type LinkedSeries,
} from './goals';

/**
 * Reading and writing finance goals (`finance_goals`,
 * `finance_goal_contributions`, service role only) and gathering what
 * progress is computed from: linked account balances and their snapshots
 * (`finance_balance_snapshots`), linked web wallets' cached balances, and
 * manual contributions.
 */

const GOAL_COLUMNS =
  'id, name, kind, target_amount, currency, start_date, deadline, starting_amount, start_progress, linked_account_ids, linked_wallet_ids, notes, archived_at, achieved_at, created_at';

function fromRow(r: Record<string, unknown>): Goal {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as Goal['kind'],
    targetAmount: Number(r.target_amount),
    currency: r.currency as string,
    startDate: String(r.start_date).slice(0, 10),
    deadline: String(r.deadline).slice(0, 10),
    startingAmount: r.starting_amount === null ? null : Number(r.starting_amount),
    startProgress: Number(r.start_progress ?? 0),
    linkedAccountIds: (r.linked_account_ids as string[] | null) ?? [],
    linkedWalletIds: (r.linked_wallet_ids as string[] | null) ?? [],
    notes: (r.notes as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    achievedAt: (r.achieved_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function contributionFromRow(r: Record<string, unknown>): Contribution {
  return {
    id: r.id as string,
    goalId: r.goal_id as string,
    amount: Number(r.amount),
    occurredOn: String(r.occurred_on).slice(0, 10),
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Chain symbol to the rate symbol it is priced by; stablecoins are a dollar. */
function rateSymbol(chain: string): string | null {
  const c = chain.toUpperCase();
  if (c.startsWith('USDC') || c.startsWith('USDT')) return 'USD';
  if (c === 'LN') return 'BTC';
  return c;
}

export async function listGoals(merchantId: string, { includeArchived = false } = {}): Promise<Goal[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase.from('finance_goals').select(GOAL_COLUMNS).eq('merchant_id', merchantId).order('deadline').order('created_at');
  if (!includeArchived) query = query.is('archived_at', null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load goals: ${error.message}`);
  return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
}

export async function getGoal(merchantId: string, id: string): Promise<Goal | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('finance_goals').select(GOAL_COLUMNS).eq('merchant_id', merchantId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load the goal: ${error.message}`);
  return data ? fromRow(data as Record<string, unknown>) : null;
}

/** The web wallets linked to this merchant (`wallet_account_links`). */
export async function listMerchantWallets(merchantId: string): Promise<Array<{ walletId: string; label: string | null }>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('wallet_account_links').select('wallet_id, label').eq('merchant_id', merchantId);
  if (error) throw new Error(`Could not load wallets: ${error.message}`);
  const seen = new Set<string>();
  const out: Array<{ walletId: string; label: string | null }> = [];
  for (const r of data ?? []) {
    const id = r.wallet_id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ walletId: id, label: (r.label as string | null) ?? null });
  }
  return out;
}

/** Linked ids must belong to the merchant: accounts through its connections, wallets through its links. */
async function assertOwnership(merchantId: string, accountIds: string[], walletIds: string[], accounts?: AccountView[]): Promise<void> {
  if (accountIds.length > 0) {
    const owned = new Set((accounts ?? (await listAccounts(merchantId, { includeHidden: true }))).map((a) => a.id));
    const foreign = accountIds.filter((id) => !owned.has(id));
    if (foreign.length) throw new GoalError(`Not one of your finance accounts: ${foreign.join(', ')}`);
  }
  if (walletIds.length > 0) {
    const owned = new Set((await listMerchantWallets(merchantId)).map((w) => w.walletId));
    const foreign = walletIds.filter((id) => !owned.has(id));
    if (foreign.length) throw new GoalError(`Not one of your linked wallets: ${foreign.join(', ')}`);
  }
}

/** USD value of the given wallets from their cached balances; never calls a chain. */
async function walletsUsd(walletIds: string[]): Promise<{ usd: number; priced: boolean }> {
  if (walletIds.length === 0) return { usd: 0, priced: true };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('wallet_addresses')
    .select('chain, cached_balance')
    .in('wallet_id', walletIds)
    .eq('is_active', true);
  if (error) throw new Error(`Could not load wallet balances: ${error.message}`);
  const byChain = new Map<string, number>();
  for (const r of data ?? []) {
    const bal = Number(r.cached_balance ?? 0);
    if (!Number.isFinite(bal) || bal <= 0) continue;
    byChain.set(r.chain as string, (byChain.get(r.chain as string) ?? 0) + bal);
  }
  let usd = 0;
  let priced = true;
  const { getExchangeRate } = await import('../rates/tatum');
  for (const [chain, amount] of byChain) {
    const symbol = rateSymbol(chain);
    if (symbol === 'USD') {
      usd += amount;
      continue;
    }
    try {
      usd += amount * (await getExchangeRate(symbol!, 'USD'));
    } catch {
      priced = false;
    }
  }
  return { usd: Math.round(usd * 100) / 100, priced };
}

/**
 * Everything progress needs for a set of goals, loaded once: the merchant's
 * accounts, snapshots of the linked ones since `since`, contributions, and
 * each goal's wallet value.
 */
export async function loadInputs(merchantId: string, goals: Goal[], since: Date): Promise<Map<string, GoalInputs>> {
  const supabase = getSupabaseAdmin();
  const out = new Map<string, GoalInputs>();
  if (goals.length === 0) return out;
  const linkedIds = [...new Set(goals.flatMap((g) => g.linkedAccountIds))];
  const accounts = linkedIds.length ? await listAccounts(merchantId, { includeHidden: true }) : [];
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const history = new Map<string, Array<{ at: string; value: number }>>();
  if (linkedIds.length) {
    // The last snapshot before `since` anchors each series; one per account is plenty.
    const { data, error } = await supabase
      .from('finance_balance_snapshots')
      .select('account_id, balance, observed_at')
      .in('account_id', linkedIds.filter((id) => byId.has(id)))
      .gte('observed_at', new Date(since.getTime() - 45 * 86_400_000).toISOString())
      .order('observed_at', { ascending: true })
      .limit(10_000);
    if (error) throw new Error(`Could not load balance history: ${error.message}`);
    for (const r of data ?? []) {
      const acct = byId.get(r.account_id as string);
      if (!acct) continue;
      const raw = Number(r.balance);
      if (!Number.isFinite(raw)) continue;
      const list = history.get(acct.id) ?? [];
      list.push({ at: r.observed_at as string, value: acct.is_liability ? -raw : raw });
      history.set(acct.id, list);
    }
  }

  const { data: contribRows, error: contribError } = await supabase
    .from('finance_goal_contributions')
    .select('id, goal_id, amount, occurred_on, note, created_at')
    .in('goal_id', goals.map((g) => g.id))
    .order('occurred_on');
  if (contribError) throw new Error(`Could not load contributions: ${contribError.message}`);
  const contributions = (contribRows ?? []).map((r) => contributionFromRow(r as Record<string, unknown>));

  for (const goal of goals) {
    const series: LinkedSeries[] = goal.linkedAccountIds
      .map((id) => byId.get(id))
      .filter((a): a is AccountView => Boolean(a))
      .map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency || 'USD',
        liability: a.is_liability,
        current: a.display_balance,
        history: history.get(a.id) ?? [],
        institution: a.org_name ?? null,
        kind: a.effective_kind,
        asOf: a.balance_date ?? null,
      }));
    const wallets = goal.linkedWalletIds.length ? await walletsUsd(goal.linkedWalletIds) : { usd: 0, priced: true };
    out.set(goal.id, {
      accounts: series,
      walletsUsd: wallets.usd,
      walletsPriced: wallets.priced,
      contributions: contributions.filter((c) => c.goalId === goal.id),
    });
  }
  return out;
}

export async function createGoal(merchantId: string, body: Record<string, unknown>, timezone: string): Promise<Goal> {
  const today = localDate(new Date(), timezone);
  const draft = normalizeGoal(body, undefined, today);
  await assertOwnership(merchantId, draft.linkedAccountIds, draft.linkedWalletIds);

  // Where the goal starts: a linked savings account already holding money
  // starts there, and a payoff goal with no stated debt starts at what the
  // linked accounts owe now.
  const probe: Goal = { ...draft, id: randomUUID(), startProgress: 0, archivedAt: null, achievedAt: null, createdAt: new Date().toISOString() };
  const inputs = (await loadInputs(merchantId, [probe], new Date())).get(probe.id)!;
  if (draft.kind === 'debt_payoff' && draft.startingAmount === null && draft.linkedAccountIds.length > 0) {
    const owed = inputs.accounts.filter((a) => a.currency === draft.currency).reduce((s, a) => s + (a.current ?? 0), 0);
    if (owed <= 0) throw new GoalError('The linked accounts owe nothing right now; set startingAmount to the debt you are paying off');
    draft.startingAmount = Math.round(owed * 100) / 100;
    if (body.targetAmount === undefined) draft.targetAmount = draft.startingAmount;
  }
  probe.startingAmount = draft.startingAmount;
  probe.targetAmount = draft.targetAmount;
  const startProgress = progressAt(probe, inputs, new Date(), { now: true }).progress;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_goals')
    .insert({
      merchant_id: merchantId,
      name: draft.name,
      kind: draft.kind,
      target_amount: draft.targetAmount,
      currency: draft.currency,
      start_date: draft.startDate,
      deadline: draft.deadline,
      starting_amount: draft.startingAmount,
      start_progress: startProgress,
      linked_account_ids: draft.linkedAccountIds,
      linked_wallet_ids: draft.linkedWalletIds,
      notes: draft.notes,
    })
    .select(GOAL_COLUMNS)
    .single();
  if (error) throw new Error(`Could not save the goal: ${error.message}`);
  const goal = fromRow(data as Record<string, unknown>);
  await audit(merchantId, 'goal.create', 'goal', goal.id, { kind: goal.kind, linked: goal.linkedAccountIds.length + goal.linkedWalletIds.length });
  return goal;
}

export async function updateGoal(merchantId: string, id: string, body: Record<string, unknown>): Promise<Goal | null> {
  const existing = await getGoal(merchantId, id);
  if (!existing) return null;
  const draft = normalizeGoal(body, existing);
  await assertOwnership(merchantId, draft.linkedAccountIds, draft.linkedWalletIds);
  const patch: Record<string, unknown> = {
    name: draft.name,
    kind: draft.kind,
    target_amount: draft.targetAmount,
    currency: draft.currency,
    start_date: draft.startDate,
    deadline: draft.deadline,
    starting_amount: draft.startingAmount,
    linked_account_ids: draft.linkedAccountIds,
    linked_wallet_ids: draft.linkedWalletIds,
    notes: draft.notes,
    updated_at: new Date().toISOString(),
  };
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') throw new GoalError('archived must be true or false');
    patch.archived_at = body.archived ? existing.archivedAt ?? new Date().toISOString() : null;
  }
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const basisChanged =
    !same(draft.linkedAccountIds, existing.linkedAccountIds) ||
    !same(draft.linkedWalletIds, existing.linkedWalletIds) ||
    draft.kind !== existing.kind ||
    draft.currency !== existing.currency ||
    draft.startDate !== existing.startDate ||
    draft.startingAmount !== existing.startingAmount ||
    draft.targetAmount !== existing.targetAmount;
  if (body.startProgress !== undefined) {
    const sp = Number(body.startProgress);
    if (!Number.isFinite(sp)) throw new GoalError('startProgress must be a number');
    patch.start_progress = Math.round(sp * 100) / 100;
  } else if (basisChanged) {
    // Different accounts (or a different start) mean a different starting
    // point: re-read where the new set stood on the start date, so on-track
    // is not measured from balances the goal no longer counts.
    const probe: Goal = { ...existing, ...draft };
    const startAt = new Date(Math.min(Date.now(), Date.parse(`${draft.startDate}T23:59:59Z`)));
    const inputs = (await loadInputs(merchantId, [probe], startAt)).get(probe.id)!;
    patch.start_progress = progressAt(probe, inputs, startAt).progress;
  }
  // Achieved is re-judged against the edited goal the next time it is read.
  if (basisChanged) patch.achieved_at = null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('finance_goals').update(patch).eq('merchant_id', merchantId).eq('id', id).select(GOAL_COLUMNS).single();
  if (error) throw new Error(`Could not update the goal: ${error.message}`);
  await audit(merchantId, 'goal.update', 'goal', id, { fields: Object.keys(body).join(',') });
  return fromRow(data as Record<string, unknown>);
}

export async function deleteGoal(merchantId: string, id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('finance_goals').delete().eq('merchant_id', merchantId).eq('id', id).select('id');
  if (error) throw new Error(`Could not delete the goal: ${error.message}`);
  const removed = (data ?? []).length > 0;
  if (removed) await audit(merchantId, 'goal.delete', 'goal', id, {});
  return removed;
}

export async function listContributions(merchantId: string, goalId: string): Promise<Contribution[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_goal_contributions')
    .select('id, goal_id, amount, occurred_on, note, created_at')
    .eq('merchant_id', merchantId)
    .eq('goal_id', goalId)
    .order('occurred_on', { ascending: false });
  if (error) throw new Error(`Could not load contributions: ${error.message}`);
  return (data ?? []).map((r) => contributionFromRow(r as Record<string, unknown>));
}

export async function addContribution(merchantId: string, goalId: string, body: Record<string, unknown>, timezone: string): Promise<Contribution | null> {
  const goal = await getGoal(merchantId, goalId);
  if (!goal) return null;
  const c = normalizeContribution(body, localDate(new Date(), timezone), goal.startDate);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_goal_contributions')
    .insert({ goal_id: goalId, merchant_id: merchantId, amount: c.amount, occurred_on: c.occurredOn, note: c.note })
    .select('id, goal_id, amount, occurred_on, note, created_at')
    .single();
  if (error) throw new Error(`Could not save the contribution: ${error.message}`);
  await audit(merchantId, 'goal.contribute', 'goal', goalId, { withdrawal: c.amount < 0 });
  return contributionFromRow(data as Record<string, unknown>);
}

export async function deleteContribution(merchantId: string, goalId: string, contributionId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_goal_contributions')
    .delete()
    .eq('merchant_id', merchantId)
    .eq('goal_id', goalId)
    .eq('id', contributionId)
    .select('id');
  if (error) throw new Error(`Could not delete the contribution: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Goals with where each stands today. */
export async function goalsWithProgress(merchantId: string, timezone: string, { includeArchived = false, now = new Date() } = {}) {
  const goals = await listGoals(merchantId, { includeArchived });
  const today = localDate(now, timezone);
  const inputs = await loadInputs(merchantId, goals, new Date(now.getTime() - 92 * 86_400_000));
  const out = goals.map((goal) => {
    const inp = inputs.get(goal.id)!;
    return {
      ...goal,
      direction: goal.kind === 'debt_payoff' ? 'payoff' : 'save',
      snapshot: snapshotGoal(goal, inp, now, today),
      sources: goalBreakdown(goal, inp, now),
      linked: { accounts: inp.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balance: a.current, liability: a.liability })), walletsUsd: inp.walletsUsd, walletsPriced: inp.walletsPriced },
    };
  });
  // First time a goal is seen achieved, remember when.
  const newlyAchieved = out.filter((g) => g.snapshot.status === 'achieved' && !g.achievedAt).map((g) => g.id);
  if (newlyAchieved.length) {
    const at = now.toISOString();
    await getSupabaseAdmin().from('finance_goals').update({ achieved_at: at }).eq('merchant_id', merchantId).in('id', newlyAchieved);
    for (const g of out) if (newlyAchieved.includes(g.id)) g.achievedAt = at;
  }
  return out;
}

/** The daily/weekly/monthly/quarterly report across every active goal. */
export async function goalsReport(merchantId: string, period: GoalPeriod, timezone: string, now: Date = new Date()): Promise<GoalReport> {
  const goals = await listGoals(merchantId);
  const today = localDate(now, timezone);
  const inputs = await loadInputs(merchantId, goals, new Date(now.getTime() - 95 * 86_400_000));
  return buildReport(goals.map((goal) => ({ goal, inputs: inputs.get(goal.id)! })), period, now, today);
}

/** The owner's finance timezone (or `?timezone=` for this request alone), UTC when none is saved. */
export async function goalsTimezone(merchantId: string, explicit?: string | null): Promise<string> {
  const { resolveFinanceTimezone } = await import('./settings');
  return (await resolveFinanceTimezone(merchantId, explicit ?? undefined, { remember: false }))?.timezone ?? 'UTC';
}
