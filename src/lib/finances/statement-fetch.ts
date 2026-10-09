import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';
import { listAccounts } from './summary';
import { listStatements } from './statements';
import { auditFinance } from './audit';
import { institutionKey } from './statement-pages';

/**
 * Statement fetching: the server's half.
 *
 * SimpleFIN carries balances and transactions and never the PDF statements
 * the banks issue, so `coinpay finances statements fetch` downloads them from
 * each bank on the merchant's own machine, where the bank session lives in a
 * Chrome profile CoinPay never sees. The PDFs arrive through the statement
 * library unchanged. This module keeps the rest: one row per bank per run
 * (`finance_statement_fetch_runs`, counts only), and which account-months
 * still have no statement, so the PWA, the API and the MCP server can all
 * say "Chase needs signing in again" and "August is missing for Sapphire".
 */

export const FETCH_RUN_STATUSES = ['ok', 'login_needed', 'no_statements', 'error'] as const;
export type FetchRunStatus = (typeof FETCH_RUN_STATUSES)[number];

export class FetchRunError extends Error {
  code = 'invalid_request';
  status = 400;
}

export { institutionKey } from './statement-pages';

export interface FetchRunInput {
  institutionKey: string;
  institutionLabel: string | null;
  status: FetchRunStatus;
  candidates: number;
  filed: number;
  duplicates: number;
  unmatched: number;
  silent: number;
  message: string | null;
  client: string | null;
  startedAt: string;
  finishedAt: string;
}

function count(body: Record<string, unknown>, name: string): number {
  const value = body[name] ?? 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new FetchRunError(`${name} must be a whole number from 0`);
  }
  return value;
}

function shortText(body: Record<string, unknown>, name: string, max: number): string | null {
  const value = body[name];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new FetchRunError(`${name} must be text`);
  return value.trim().slice(0, max) || null;
}

function instant(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new FetchRunError(`${name} must be an ISO timestamp`);
  return new Date(ms).toISOString();
}

/** Validate a run report from a fetcher. Only counts and a short message are kept. */
export function parseFetchRun(raw: unknown, now: Date = new Date()): FetchRunInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FetchRunError('Expected a JSON object');
  const body = raw as Record<string, unknown>;
  const key = body.institutionKey;
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(key)) {
    throw new FetchRunError('institutionKey must be a lowercase key such as "chase"');
  }
  const status = body.status;
  if (typeof status !== 'string' || !(FETCH_RUN_STATUSES as readonly string[]).includes(status)) {
    throw new FetchRunError(`status must be one of ${FETCH_RUN_STATUSES.join(', ')}`);
  }
  const startedAt = instant(body, 'startedAt');
  const finishedAt = instant(body, 'finishedAt');
  if (finishedAt < startedAt) throw new FetchRunError('finishedAt is before startedAt');
  if (Date.parse(finishedAt) > now.getTime() + 5 * 60_000) throw new FetchRunError('finishedAt is in the future');
  return {
    institutionKey: key,
    institutionLabel: shortText(body, 'institutionLabel', 120),
    status: status as FetchRunStatus,
    candidates: count(body, 'candidates'),
    filed: count(body, 'filed'),
    duplicates: count(body, 'duplicates'),
    unmatched: count(body, 'unmatched'),
    silent: count(body, 'silent'),
    message: shortText(body, 'message', 500),
    client: shortText(body, 'client', 80),
    startedAt,
    finishedAt,
  };
}

export interface FetchRunRow {
  id: string;
  institution_key: string;
  institution_label: string | null;
  status: FetchRunStatus;
  candidates: number;
  filed: number;
  duplicates: number;
  unmatched: number;
  silent: number;
  message: string | null;
  client: string | null;
  started_at: string;
  finished_at: string;
}

const RUN_COLUMNS =
  'id, institution_key, institution_label, status, candidates, filed, duplicates, unmatched, silent, message, client, started_at, finished_at';

export function toPublicRun(run: FetchRunRow) {
  return {
    id: run.id,
    institutionKey: run.institution_key,
    institutionLabel: run.institution_label,
    status: run.status,
    candidates: run.candidates,
    filed: run.filed,
    duplicates: run.duplicates,
    unmatched: run.unmatched,
    silent: run.silent,
    message: run.message,
    client: run.client,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
  };
}

export async function recordFetchRun(access: { id: string; actorId: string }, input: FetchRunInput): Promise<FetchRunRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_statement_fetch_runs')
    .insert({
      merchant_id: access.id,
      institution_key: input.institutionKey,
      institution_label: input.institutionLabel,
      status: input.status,
      candidates: input.candidates,
      filed: input.filed,
      duplicates: input.duplicates,
      unmatched: input.unmatched,
      silent: input.silent,
      message: input.message,
      client: input.client,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      reported_by: access.actorId,
    })
    .select(RUN_COLUMNS)
    .single();
  if (error) throw new Error(`Could not record the fetch run: ${error.message}`);
  await auditFinance(access, 'statement_fetch.reported', 'statement_fetch_run', (data as FetchRunRow).id, {
    institution: input.institutionKey,
    status: input.status,
    filed: input.filed,
  });
  return data as FetchRunRow;
}

export async function listFetchRuns(merchantId: string, { limit = 200 }: { limit?: number } = {}): Promise<FetchRunRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_statement_fetch_runs')
    .select(RUN_COLUMNS)
    .eq('merchant_id', merchantId)
    .order('finished_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 1000));
  if (error) throw new Error(`Could not list fetch runs: ${error.message}`);
  return (data ?? []) as FetchRunRow[];
}

/** The newest run per institution, newest first. Expects runs newest first. */
export function latestByInstitution<T extends { institution_key: string }>(runs: readonly T[]): T[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    if (seen.has(run.institution_key)) return false;
    seen.add(run.institution_key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Coverage: which account-months have a statement
// ---------------------------------------------------------------------------

/** The month a statement closed in: the day before its exclusive end. */
export function closingMonth(periodEnd: string): string {
  const end = new Date(`${periodEnd}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 7);
}

/** The last `count` months, oldest first, ending with the current one. */
export function recentMonths(count: number, now: Date = new Date()): string[] {
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

export interface CoverageAccount {
  id: string;
  name: string;
  org_name: string | null;
  org_domain: string | null;
}

export interface CoverageStatement {
  id: string;
  account_id: string;
  period_end: string;
}

export interface AccountCoverage {
  accountId: string;
  accountName: string;
  institutionKey: string;
  institutionLabel: string | null;
  months: { month: string; statementId: string | null; state: 'have' | 'missing' | 'open' }[];
  missing: number;
}

/**
 * Per account, the last `months` months: `have` when a statement closed in
 * that month, `missing` when none did, and `open` for the current month,
 * whose statement most banks have not issued yet.
 */
export function buildStatementCoverage(
  accounts: readonly CoverageAccount[],
  statements: readonly CoverageStatement[],
  { months = 12, now = new Date() }: { months?: number; now?: Date } = {},
): AccountCoverage[] {
  const window = recentMonths(months, now);
  const current = window[window.length - 1];
  const byAccountMonth = new Map<string, string>();
  for (const statement of statements) {
    const key = `${statement.account_id}|${closingMonth(statement.period_end)}`;
    if (!byAccountMonth.has(key)) byAccountMonth.set(key, statement.id);
  }
  return accounts.map((account) => {
    const cells = window.map((month) => {
      const statementId = byAccountMonth.get(`${account.id}|${month}`) ?? null;
      const state: 'have' | 'missing' | 'open' = statementId ? 'have' : month === current ? 'open' : 'missing';
      return { month, statementId, state };
    });
    return {
      accountId: account.id,
      accountName: account.name,
      institutionKey: institutionKey(account.org_domain, account.org_name),
      institutionLabel: account.org_name,
      months: cells,
      missing: cells.filter((cell) => cell.state === 'missing').length,
    };
  });
}

export async function getStatementCoverage(merchantId: string, months = 12, now: Date = new Date()): Promise<{ months: string[]; accounts: AccountCoverage[] }> {
  const window = recentMonths(months, now);
  const from = `${window[0]}-01`;
  const [accounts, statements] = await Promise.all([
    listAccounts(merchantId),
    // A statement that closes inside the window ends on or before the 1st of the month after it.
    listStatements(merchantId, { from, to: '9999-12-31', limit: 500 }),
  ]);
  return { months: window, accounts: buildStatementCoverage(accounts, statements, { months, now }) };
}
