/**
 * Finance goals: saving toward something (a house, a car, an emergency fund)
 * or paying something off, by a deadline.
 *
 * Pure: validation, progress at an instant, the on-track verdict and the
 * daily/weekly/monthly/quarterly period reports. The store
 * (`goals-store.ts`) gathers balances, snapshots and contributions and hands
 * them here. Nothing in this module moves money, and none of it is financial
 * advice: it is arithmetic on the owner's own numbers.
 *
 * Progress, in the goal's currency:
 *
 * - save, linked: the linked balances now (accounts plus web wallets) plus
 *   manual contributions. The linked account IS the savings bucket.
 * - save, unlinked: `startingAmount` (already saved) plus contributions.
 * - payoff, linked: `startingAmount` (the debt at the start) minus what the
 *   linked liabilities owe now, plus contributions.
 * - payoff, unlinked: contributions (payments recorded by hand).
 *
 * "On track" compares progress with a straight line from `startProgress` on
 * the start date to the target on the deadline.
 */

export type GoalKind = 'house' | 'car' | 'emergency_fund' | 'debt_payoff' | 'custom';
export const GOAL_KINDS: GoalKind[] = ['house', 'car', 'emergency_fund', 'debt_payoff', 'custom'];
export type GoalDirection = 'save' | 'payoff';
export type GoalPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export const GOAL_PERIODS: GoalPeriod[] = ['daily', 'weekly', 'monthly', 'quarterly'];
export type GoalStatus = 'achieved' | 'on_track' | 'behind' | 'overdue';

export const GOAL_DISCLAIMER = 'Not financial advice. Arithmetic on your own balances and the targets you set; nothing here moves money.';

export const KIND_LABELS: Record<GoalKind, string> = {
  house: 'Buy a house',
  car: 'Buy a car',
  emergency_fund: 'Emergency fund',
  debt_payoff: 'Pay off debt',
  custom: 'Custom',
};

export class GoalError extends Error {
  code = 'invalid_request' as const;
  status = 400;
}

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  targetAmount: number;
  currency: string;
  startDate: string;
  deadline: string;
  startingAmount: number | null;
  startProgress: number;
  linkedAccountIds: string[];
  linkedWalletIds: string[];
  notes: string | null;
  archivedAt: string | null;
  achievedAt: string | null;
  createdAt: string;
}

export interface Contribution {
  id: string;
  goalId: string;
  amount: number;
  occurredOn: string;
  note: string | null;
  createdAt: string;
}

/** A linked account's value over time, already signed for the goal: assets positive, debts as amount owed. */
export interface LinkedSeries {
  id: string;
  name: string;
  currency: string;
  liability: boolean;
  /** Current balance as shown (owed amount for a liability). */
  current: number | null;
  /** Snapshots as shown, oldest first. */
  history: Array<{ at: string; value: number }>;
  institution?: string | null;
  kind?: string | null;
  /** When the feed last reported `current`. */
  asOf?: string | null;
}

export interface GoalInputs {
  accounts: LinkedSeries[];
  /** Current USD value of the linked web wallets (no history is kept for them). */
  walletsUsd: number;
  walletsPriced: boolean;
  contributions: Contribution[];
}

export const directionOf = (kind: GoalKind): GoalDirection => (kind === 'debt_payoff' ? 'payoff' : 'save');

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.436875;

export function isGoalKind(v: unknown): v is GoalKind {
  return typeof v === 'string' && (GOAL_KINDS as string[]).includes(v);
}

export function isGoalPeriod(v: unknown): v is GoalPeriod {
  return typeof v === 'string' && (GOAL_PERIODS as string[]).includes(v);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new GoalError(`${field} must be a date like 2031-06-30`);
  }
  return v;
}

function parseAmount(v: unknown, field: string, { allowZero = false, allowNegative = false } = {}): number {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : Number(v);
  if (!Number.isFinite(n)) throw new GoalError(`${field} must be a number`);
  if (!allowNegative && n < 0) throw new GoalError(`${field} cannot be negative`);
  if (!allowZero && n === 0) throw new GoalError(`${field} cannot be zero`);
  if (Math.abs(n) >= 1e15) throw new GoalError(`${field} is too large`);
  if (Math.round(n * 100) / 100 !== n && Math.abs(Math.round(n * 100) / 100 - n) > 1e-9) {
    throw new GoalError(`${field} takes at most two decimals`);
  }
  return round2(n);
}

function parseIds(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new GoalError(`${field} must be a list of ids`);
  const ids = [...new Set(v.map(String))];
  if (ids.length > 50) throw new GoalError(`${field}: at most 50`);
  for (const id of ids) if (!UUID_RE.test(id)) throw new GoalError(`${field}: ${id} is not an id`);
  return ids;
}

export interface GoalDraft {
  name: string;
  kind: GoalKind;
  targetAmount: number;
  currency: string;
  startDate: string;
  deadline: string;
  startingAmount: number | null;
  linkedAccountIds: string[];
  linkedWalletIds: string[];
  notes: string | null;
}

/**
 * Validate a create (no `existing`) or a patch (merged over `existing`).
 * Throws `GoalError` with a message fit for the API.
 */
export function normalizeGoal(input: Record<string, unknown>, existing?: GoalDraft, today?: string): GoalDraft {
  const has = (k: string) => input[k] !== undefined;
  const name = has('name') ? String(input.name ?? '').trim() : existing?.name ?? '';
  if (!name || name.length > 80) throw new GoalError('name is required, at most 80 characters');
  const kindRaw = has('kind') ? input.kind : existing?.kind ?? 'custom';
  if (!isGoalKind(kindRaw)) throw new GoalError(`kind must be one of ${GOAL_KINDS.join(', ')}`);
  const currency = has('currency') ? String(input.currency).trim().toUpperCase() : existing?.currency ?? 'USD';
  if (!/^[A-Z]{3}$/.test(currency)) throw new GoalError('currency must be a 3-letter code like USD');
  const startDate = has('startDate') ? parseDate(input.startDate, 'startDate') : existing?.startDate ?? today ?? new Date().toISOString().slice(0, 10);
  const deadline = has('deadline') ? parseDate(input.deadline, 'deadline') : existing?.deadline;
  if (!deadline) throw new GoalError('deadline is required');
  if (deadline <= startDate) throw new GoalError('deadline must be after the start date');
  const linkedAccountIds = has('linkedAccountIds') ? parseIds(input.linkedAccountIds, 'linkedAccountIds') : existing?.linkedAccountIds ?? [];
  const linkedWalletIds = has('linkedWalletIds') ? parseIds(input.linkedWalletIds, 'linkedWalletIds') : existing?.linkedWalletIds ?? [];
  if (kindRaw === 'debt_payoff' && linkedWalletIds.length > 0) throw new GoalError('a payoff goal links debt accounts, not wallets');
  const startingAmount = has('startingAmount')
    ? (input.startingAmount === null ? null : parseAmount(input.startingAmount, 'startingAmount', { allowZero: true }))
    : existing?.startingAmount ?? null;
  // A payoff goal's target is the debt; give it whichever of the two is set.
  let targetRaw = has('targetAmount') ? input.targetAmount : existing?.targetAmount;
  if ((targetRaw === undefined || targetRaw === null) && kindRaw === 'debt_payoff' && startingAmount) targetRaw = startingAmount;
  if (targetRaw === undefined || targetRaw === null) throw new GoalError('targetAmount is required');
  const targetAmount = parseAmount(targetRaw, 'targetAmount');
  const notes = has('notes') ? (input.notes === null ? null : String(input.notes).trim().slice(0, 500) || null) : existing?.notes ?? null;
  return { name, kind: kindRaw, targetAmount, currency, startDate, deadline, startingAmount, linkedAccountIds, linkedWalletIds, notes };
}

export function normalizeContribution(input: Record<string, unknown>, today: string, startDate?: string): { amount: number; occurredOn: string; note: string | null } {
  const amount = parseAmount(input.amount, 'amount', { allowNegative: true });
  const occurredOn = input.occurredOn === undefined || input.occurredOn === null || input.occurredOn === '' ? today : parseDate(input.occurredOn, 'occurredOn');
  if (occurredOn > today) throw new GoalError('occurredOn cannot be in the future');
  // The goal's starting point already holds anything from before it began.
  if (startDate && occurredOn < startDate) throw new GoalError(`occurredOn cannot be before the goal started (${startDate}); raise startingAmount instead`);
  const note = input.note === undefined || input.note === null ? null : String(input.note).trim().slice(0, 200) || null;
  return { amount, occurredOn, note };
}

/** A series' value at an instant: the last snapshot at or before it, else the earliest known, else now. */
export function seriesValueAt(series: LinkedSeries, at: Date): { value: number | null; exact: boolean } {
  const t = at.getTime();
  let best: { at: string; value: number } | null = null;
  for (const point of series.history) {
    if (Date.parse(point.at) <= t) best = point;
    else break;
  }
  if (best) return { value: best.value, exact: true };
  if (series.history.length > 0) return { value: series.history[0].value, exact: false };
  return { value: series.current, exact: false };
}

export interface ProgressPoint {
  progress: number;
  linked: number;
  contributed: number;
  /** False when a linked balance before `at` was unknown and the nearest later one stood in. */
  exact: boolean;
}

/**
 * Progress toward the goal at `at`. `now` true reads current balances
 * instead of snapshots.
 */
export function progressAt(goal: Pick<Goal, 'kind' | 'currency' | 'startingAmount' | 'targetAmount' | 'linkedAccountIds' | 'linkedWalletIds'>, inputs: GoalInputs, at: Date, { now = false }: { now?: boolean } = {}): ProgressPoint {
  const day = at.toISOString().slice(0, 10);
  const contributed = round2(inputs.contributions.filter((c) => c.occurredOn <= day).reduce((s, c) => s + c.amount, 0));
  const accounts = inputs.accounts.filter((a) => a.currency === goal.currency);
  const linkedAny = goal.linkedAccountIds.length > 0 || goal.linkedWalletIds.length > 0;
  let exact = true;
  let balances = 0;
  const save = directionOf(goal.kind) === 'save';
  for (const a of accounts) {
    const v = now ? { value: a.current, exact: true } : seriesValueAt(a, at);
    if (!v.exact) exact = false;
    // A debt linked to a savings goal counts against it (net worth), never as money held.
    balances += (save && a.liability ? -1 : 1) * (v.value ?? 0);
  }
  if (goal.currency === 'USD') balances += inputs.walletsUsd;
  balances = round2(balances);

  if (directionOf(goal.kind) === 'payoff') {
    if (!linkedAny) return { progress: contributed, linked: 0, contributed, exact: true };
    const startDebt = goal.startingAmount ?? goal.targetAmount;
    const paid = round2(startDebt - balances);
    return { progress: round2(paid + contributed), linked: paid, contributed, exact };
  }
  if (!linkedAny) {
    const base = goal.startingAmount ?? 0;
    return { progress: round2(base + contributed), linked: 0, contributed, exact: true };
  }
  return { progress: round2(balances + contributed), linked: balances, contributed, exact };
}

/** A balance older than this is flagged: the feed may have stopped updating. */
export const STALE_BALANCE_DAYS = 7;

/** One line of what a goal's progress is made of. Counted amounts sum to `progressAt(..., { now: true }).progress`. */
export interface GoalSource {
  type: 'account' | 'wallets' | 'contributions' | 'starting';
  id: string | null;
  name: string;
  institution: string | null;
  kind: string | null;
  /** Signed: what this source adds to progress now (a debt subtracts). */
  amount: number;
  /** When the balance was last reported, for accounts. */
  asOf: string | null;
  stale: boolean;
  /** False for a linked account in another currency, which the goal cannot add up. */
  counted: boolean;
}

/** Where today's progress comes from, largest first: the starting point, every linked account, the wallets and recorded contributions. */
export function goalBreakdown(
  goal: Pick<Goal, 'kind' | 'currency' | 'startingAmount' | 'targetAmount' | 'linkedAccountIds' | 'linkedWalletIds'>,
  inputs: GoalInputs,
  now: Date,
): GoalSource[] {
  const out: GoalSource[] = [];
  const payoff = directionOf(goal.kind) === 'payoff';
  const linkedAny = goal.linkedAccountIds.length > 0 || goal.linkedWalletIds.length > 0;
  const staleBefore = now.getTime() - STALE_BALANCE_DAYS * DAY_MS;
  const base = { id: null, institution: null, kind: null, asOf: null, stale: false, counted: true };
  if (payoff && linkedAny) out.push({ ...base, type: 'starting', name: 'Debt at the start', amount: round2(goal.startingAmount ?? goal.targetAmount) });
  else if (!payoff && !linkedAny && goal.startingAmount) out.push({ ...base, type: 'starting', name: 'Already saved at the start', amount: round2(goal.startingAmount) });
  for (const a of inputs.accounts) {
    const counted = a.currency === goal.currency;
    const value = a.current ?? 0;
    const amount = payoff || a.liability ? -value : value;
    const asOf = a.asOf ?? null;
    out.push({
      type: 'account',
      id: a.id,
      name: a.name,
      institution: a.institution ?? null,
      kind: a.kind ?? null,
      amount: counted ? round2(amount) : 0,
      asOf,
      stale: asOf ? Date.parse(asOf) < staleBefore : false,
      counted,
    });
  }
  if (goal.linkedWalletIds.length > 0) {
    const n = goal.linkedWalletIds.length;
    out.push({ ...base, type: 'wallets', name: `${n} web wallet${n === 1 ? '' : 's'}${inputs.walletsPriced ? '' : ' (some unpriced)'}`, institution: 'CoinPay', kind: 'wallet', amount: goal.currency === 'USD' ? round2(inputs.walletsUsd) : 0, counted: goal.currency === 'USD' });
  }
  const day = now.toISOString().slice(0, 10);
  const recorded = inputs.contributions.filter((c) => c.occurredOn <= day);
  if (recorded.length > 0) {
    out.push({ ...base, type: 'contributions', name: `${recorded.length} recorded ${payoff ? 'payment' : 'contribution'}${recorded.length === 1 ? '' : 's'}`, amount: round2(recorded.reduce((s, c) => s + c.amount, 0)) });
  }
  const rank = (s: GoalSource) => (s.type === 'starting' ? 0 : 1);
  return out.sort((x, y) => rank(x) - rank(y) || Math.abs(y.amount) - Math.abs(x.amount));
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export interface GoalSnapshot {
  progress: number;
  remaining: number;
  percent: number;
  expectedByNow: number;
  status: GoalStatus;
  daysLeft: number;
  /** What it takes from today to hit the target on the deadline. */
  required: { perDay: number; perWeek: number; perMonth: number; perQuarter: number };
  /** Change per month over the trailing 90 days, or since the start if younger. */
  recentPerMonth: number | null;
  /** When the goal lands at the recent pace, or null when the pace is flat or negative. */
  projectedDate: string | null;
  exact: boolean;
}

/** Where a goal stands today (`today` is the owner's local date). */
export function snapshotGoal(goal: Goal, inputs: GoalInputs, now: Date, today: string): GoalSnapshot {
  const cur = progressAt(goal, inputs, now, { now: true });
  const remaining = round2(Math.max(0, goal.targetAmount - cur.progress));
  const percent = Math.max(0, Math.min(100, Math.round((cur.progress / goal.targetAmount) * 1000) / 10));
  const totalDays = Math.max(1, daysBetween(goal.startDate, goal.deadline));
  const elapsed = Math.min(totalDays, Math.max(0, daysBetween(goal.startDate, today)));
  const expectedByNow = round2(goal.startProgress + (goal.targetAmount - goal.startProgress) * (elapsed / totalDays));
  const daysLeft = daysBetween(today, goal.deadline);

  let status: GoalStatus;
  if (cur.progress >= goal.targetAmount) status = 'achieved';
  else if (daysLeft < 0) status = 'overdue';
  // Half a percent of the target is noise (a card statement landing a day late).
  else if (cur.progress + goal.targetAmount * 0.005 >= expectedByNow) status = 'on_track';
  else status = 'behind';

  const left = Math.max(1, daysLeft);
  const perDay = remaining / left;
  const required = {
    perDay: round2(perDay),
    perWeek: round2(Math.min(remaining, perDay * 7)),
    perMonth: round2(Math.min(remaining, perDay * AVG_MONTH_DAYS)),
    perQuarter: round2(Math.min(remaining, perDay * AVG_MONTH_DAYS * 3)),
  };

  const lookbackDays = Math.min(90, Math.max(0, daysBetween(goal.startDate, today)));
  let recentPerMonth: number | null = null;
  let projectedDate: string | null = null;
  if (lookbackDays >= 7) {
    const then = progressAt(goal, inputs, new Date(now.getTime() - lookbackDays * DAY_MS));
    const baseline = lookbackDays === daysBetween(goal.startDate, today) ? goal.startProgress : then.progress;
    recentPerMonth = round2(((cur.progress - baseline) / lookbackDays) * AVG_MONTH_DAYS);
    if (status !== 'achieved' && recentPerMonth > 0) {
      const days = Math.ceil((remaining / recentPerMonth) * AVG_MONTH_DAYS);
      projectedDate = new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
    }
  }

  return { progress: cur.progress, remaining, percent, expectedByNow, status, daysLeft, required, recentPerMonth, projectedDate, exact: cur.exact };
}

/** The trailing window a report period covers, as local dates [from, to). */
export function periodWindow(period: GoalPeriod, today: string): { from: string; to: string; days: number } {
  const [y, m, d] = today.split('-').map(Number);
  const back = (months: number) => {
    const dt = new Date(Date.UTC(y, m - 1 - months, 1));
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  const from = period === 'daily'
    ? new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
    : period === 'weekly'
      ? new Date(Date.parse(`${today}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10)
      : back(period === 'monthly' ? 1 : 3);
  return { from, to: today, days: daysBetween(from, today) };
}

export interface GoalPeriodLine {
  goal: { id: string; name: string; kind: GoalKind; currency: string; targetAmount: number; deadline: string };
  direction: GoalDirection;
  snapshot: GoalSnapshot;
  periodStart: number;
  periodEnd: number;
  change: number;
  /** What this period needed at the pace that lands the goal on time (from where it stood at the period's start). */
  neededThisPeriod: number;
  pace: 'ahead' | 'on_pace' | 'short' | 'done';
  /** What today's progress is made of. */
  sources: GoalSource[];
}

export interface GoalReport {
  period: GoalPeriod;
  from: string;
  to: string;
  generatedAt: string;
  goals: GoalPeriodLine[];
  counts: Record<GoalStatus, number>;
  disclaimer: string;
}

/** One goal's line in a period report. */
export function periodLine(goal: Goal, inputs: GoalInputs, period: GoalPeriod, now: Date, today: string): GoalPeriodLine {
  const snapshot = snapshotGoal(goal, inputs, now, today);
  const win = periodWindow(period, today);
  const startAt = new Date(Date.parse(`${win.from}T00:00:00Z`) > Date.parse(`${goal.startDate}T00:00:00Z`) ? `${win.from}T00:00:00Z` : `${goal.startDate}T00:00:00Z`);
  const fromProgress = win.from <= goal.startDate ? goal.startProgress : progressAt(goal, inputs, startAt).progress;
  const change = round2(snapshot.progress - fromProgress);
  const daysAtStart = Math.max(1, daysBetween(win.from < goal.startDate ? goal.startDate : win.from, goal.deadline));
  const coveredDays = Math.max(0, daysBetween(win.from < goal.startDate ? goal.startDate : win.from, today));
  const remainingAtStart = Math.max(0, goal.targetAmount - fromProgress);
  const neededThisPeriod = round2(Math.min(remainingAtStart, (remainingAtStart / daysAtStart) * coveredDays));
  let pace: GoalPeriodLine['pace'];
  if (snapshot.status === 'achieved') pace = 'done';
  else if (change >= neededThisPeriod * 1.05 && change > 0) pace = 'ahead';
  // A twentieth of what the period needed is noise (a payment posting a day late), never more.
  else if (change >= neededThisPeriod * 0.95) pace = 'on_pace';
  else pace = 'short';
  return {
    goal: { id: goal.id, name: goal.name, kind: goal.kind, currency: goal.currency, targetAmount: goal.targetAmount, deadline: goal.deadline },
    direction: directionOf(goal.kind),
    snapshot,
    periodStart: fromProgress,
    periodEnd: snapshot.progress,
    change,
    neededThisPeriod,
    pace,
    sources: goalBreakdown(goal, inputs, now),
  };
}

export function buildReport(goals: Array<{ goal: Goal; inputs: GoalInputs }>, period: GoalPeriod, now: Date, today: string): GoalReport {
  const win = periodWindow(period, today);
  const lines = goals.map(({ goal, inputs }) => periodLine(goal, inputs, period, now, today));
  const counts: Record<GoalStatus, number> = { achieved: 0, on_track: 0, behind: 0, overdue: 0 };
  for (const l of lines) counts[l.snapshot.status] += 1;
  return { period, from: win.from, to: win.to, generatedAt: now.toISOString(), goals: lines, counts, disclaimer: GOAL_DISCLAIMER };
}

// ---- rendering -------------------------------------------------------------

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const STATUS_LABELS: Record<GoalStatus, string> = { achieved: 'Achieved', on_track: 'On track', behind: 'Behind', overdue: 'Past deadline' };
const PERIOD_LABELS: Record<GoalPeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
const STATUS_COLORS: Record<GoalStatus, string> = { achieved: '#15803d', on_track: '#15803d', behind: '#b45309', overdue: '#b91c1c' };

export const sourceLabel = (s: GoalSource) => (s.institution && s.type === 'account' ? `${s.institution} · ${s.name}` : s.name);

/** The sources worth a line each (anything non-zero, or not counted), and how many linked accounts sit at zero. */
export function sourceLines(sources: GoalSource[]): { shown: GoalSource[]; zero: number } {
  const shown = sources.filter((s) => s.amount !== 0 || !s.counted || s.type !== 'account');
  return { shown, zero: sources.length - shown.length };
}

function sourceNote(s: GoalSource): string {
  if (!s.counted) return ' (other currency, not counted)';
  if (s.stale && s.asOf) return ` (balance from ${s.asOf.slice(0, 10)})`;
  return '';
}

export function reportSubject(report: GoalReport): string {
  const behind = report.counts.behind + report.counts.overdue;
  const n = report.goals.length;
  return `CoinPay ${PERIOD_LABELS[report.period].toLowerCase()} goals: ${n} goal${n === 1 ? '' : 's'}${behind ? `, ${behind} behind` : ', all on track'}`;
}

/** Plain-text report, for the CLI and MCP. */
export function renderReportText(report: GoalReport): string {
  const lines = [`${PERIOD_LABELS[report.period]} goals report, ${report.from} to ${report.to}`];
  if (report.goals.length === 0) lines.push('No goals yet. Create one with `coinpay finances goals create`.');
  for (const l of report.goals) {
    const s = l.snapshot;
    const m = (n: number) => formatMoney(n, l.goal.currency);
    lines.push('');
    lines.push(`${l.goal.name} (${KIND_LABELS[l.goal.kind]}): ${STATUS_LABELS[s.status]}, ${s.percent}%`);
    lines.push(`  ${m(s.progress)} of ${m(l.goal.targetAmount)} by ${l.goal.deadline} (${s.daysLeft >= 0 ? `${s.daysLeft} days left` : `${-s.daysLeft} days past`})`);
    lines.push(`  This period: ${l.change >= 0 ? '+' : ''}${m(l.change)} (needed ${m(l.neededThisPeriod)}, ${l.pace.replace('_', ' ')})`);
    if (s.status !== 'achieved') lines.push(`  To finish on time: ${m(s.required.perMonth)}/month, ${m(s.required.perWeek)}/week`);
    if (s.projectedDate) lines.push(`  At the last 90 days' pace (${m(s.recentPerMonth ?? 0)}/month) it lands ${s.projectedDate}`);
    if (!s.exact) lines.push('  (Balance history before this period is incomplete; the earliest known balance stood in.)');
    const { shown, zero } = sourceLines(l.sources ?? []);
    if (shown.length || zero) {
      lines.push(`  Made of:`);
      for (const src of shown) lines.push(`    ${m(src.amount).padStart(12)}  ${sourceLabel(src)}${sourceNote(src)}`);
      if (zero) lines.push(`    ${''.padStart(12)}  + ${zero} linked account${zero === 1 ? '' : 's'} at ${m(0)}`);
    }
  }
  lines.push('', report.disclaimer);
  return lines.join('\n');
}

function sourcesRow(l: GoalPeriodLine, td: string): string {
  const { shown, zero } = sourceLines(l.sources ?? []);
  if (!shown.length && !zero) return '';
  const m = (n: number) => esc(formatMoney(n, l.goal.currency));
  const items = shown.map((s) => `<tr><td style="padding:1px 12px 1px 0;font-size:12px;text-align:right;white-space:nowrap">${m(s.amount)}</td><td style="padding:1px 0;font-size:12px">${esc(sourceLabel(s))}<span style="color:#b45309">${esc(sourceNote(s))}</span></td></tr>`).join('');
  const more = zero ? `<tr><td></td><td style="padding:1px 0;font-size:12px;color:#666">+ ${zero} linked account${zero === 1 ? '' : 's'} at ${m(0)}</td></tr>` : '';
  return `<tr><td colspan="5" style="${td};color:#444"><span style="font-size:12px;color:#666">Made of:</span><table style="border-collapse:collapse;margin-top:2px">${items}${more}</table></td></tr>`;
}

export function renderReportHtml(report: GoalReport, links: { appUrl: string; settingsUrl?: string; unsubscribeUrl?: string }): string {
  const td = 'padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top';
  const rows = report.goals.map((l) => {
    const s = l.snapshot;
    const m = (n: number) => esc(formatMoney(n, l.goal.currency));
    const bar = `<div style="background:#eee;border-radius:4px;height:8px;width:140px;margin-top:4px"><div style="background:${STATUS_COLORS[s.status]};border-radius:4px;height:8px;width:${Math.round(s.percent * 1.4)}px"></div></div>`;
    return `<tr>
<td style="${td}"><strong>${esc(l.goal.name)}</strong><br><span style="color:#666">${esc(KIND_LABELS[l.goal.kind])} · by ${esc(l.goal.deadline)}</span></td>
<td style="${td}">${m(s.progress)} of ${m(l.goal.targetAmount)}${bar}<span style="color:#666">${s.percent}%</span></td>
<td style="${td};color:${STATUS_COLORS[s.status]}"><strong>${STATUS_LABELS[s.status]}</strong></td>
<td style="${td}">${l.change >= 0 ? '+' : ''}${m(l.change)}<br><span style="color:#666">needed ${m(l.neededThisPeriod)}</span></td>
<td style="${td}">${s.status === 'achieved' ? '-' : `${m(s.required.perMonth)}/mo`}${s.projectedDate ? `<br><span style="color:#666">lands ${esc(s.projectedDate)} at recent pace</span>` : ''}</td>
</tr>${sourcesRow(l, td)}`;
  }).join('');
  const base = links.appUrl.replace(/\/$/, '');
  const body = report.goals.length
    ? `<table style="border-collapse:collapse;width:100%"><tr><th align="left" style="${td}">Goal</th><th align="left" style="${td}">Progress</th><th align="left" style="${td}">Status</th><th align="left" style="${td}">This period</th><th align="left" style="${td}">To finish on time</th></tr>${rows}</table>`
    : `<p>No goals yet. <a href="${esc(base)}/finances/goals">Create one</a>.</p>`;
  const footer = links.unsubscribeUrl
    ? `<p style="font-size:12px;color:#666;margin:16px 0 0">You turned on this goals report. <a href="${esc(links.settingsUrl ?? `${base}/finances/goals`)}">Settings</a> · <a href="${esc(links.unsubscribeUrl)}">Turn off goals report</a></p>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;color:#111">
<h2 style="font-size:18px;margin:0 0 4px">${PERIOD_LABELS[report.period]} goals report</h2>
<p style="margin:0 0 12px;color:#555;font-size:13px">${esc(report.from)} to ${esc(report.to)} · ${report.counts.on_track + report.counts.achieved} on track or done, ${report.counts.behind + report.counts.overdue} behind · <a href="${esc(base)}/finances/goals">Open goals</a></p>
${body}
<p style="font-size:12px;color:#666;margin:12px 0 0">${esc(report.disclaimer)}</p>
${footer}
</div>`;
}

/** The next digest slot for a cadence at `hour` local time, given the local `today` and a function from local date + hour to an instant. */
export function nextCadenceRun(
  cadence: GoalPeriod,
  hour: number,
  weekday: number,
  now: Date,
  today: string,
  at: (date: string, hour: number) => Date,
): Date {
  const [y, m] = today.split('-').map(Number);
  const candidates: string[] = [];
  if (cadence === 'daily' || cadence === 'weekly') {
    for (let i = 0; i < 9; i += 1) candidates.push(new Date(Date.parse(`${today}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10));
  } else {
    for (let i = 0; i < 7; i += 1) {
      const dt = new Date(Date.UTC(y, m - 1 + i, 1));
      const month = dt.getUTCMonth();
      if (cadence === 'quarterly' && month % 3 !== 0) continue;
      candidates.push(dt.toISOString().slice(0, 10));
    }
  }
  for (const date of candidates) {
    if (cadence === 'weekly' && new Date(`${date}T00:00:00Z`).getUTCDay() !== weekday) continue;
    const instant = at(date, hour);
    if (instant > now) return instant;
  }
  throw new GoalError('Could not compute the next run');
}
