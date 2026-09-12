import 'server-only';
import { getSupabaseAdmin } from '../supabase/server';

/**
 * The local request budget for one credential.
 *
 * The bridge asks for no more than about 24 requests a day; CoinPay keeps
 * itself to 20 and hands four of those to whoever is sitting at the screen,
 * so a background backfill can never leave a merchant unable to press Sync.
 * Every request — including a retry, including one that failed — counts. The
 * budget is per credential, never multiplied by accounts, and it is enforced
 * from the database so several replicas share one count.
 */

export const REQUEST_BUDGET_PER_DAY = Number(process.env.FINANCES_REQUEST_BUDGET ?? 20);
export const BACKGROUND_BUDGET_PER_DAY = Number(process.env.FINANCES_BACKGROUND_BUDGET ?? 16);
const WINDOW_MS = 24 * 3600 * 1000;

export type RequestClass = 'interactive' | 'background';

export interface BudgetState {
  used: number;
  usedBackground: number;
  limit: number;
  backgroundLimit: number;
  /** Whether a request of this class may go out now. */
  allowed: boolean;
  /** When the oldest counted request ages out, if none are allowed now. */
  nextAvailableAt: string | null;
}

export async function checkRequestBudget(
  connectionId: string,
  requestClass: RequestClass,
  now: Date = new Date(),
): Promise<BudgetState> {
  const supabase = getSupabaseAdmin();
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('finance_request_usage')
    .select('request_class, requested_at')
    .eq('connection_id', connectionId)
    .gte('requested_at', since)
    .order('requested_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`Could not read the request budget: ${error.message}`);

  const rows = (data ?? []) as { request_class: string; requested_at: string }[];
  const used = rows.length;
  const usedBackground = rows.filter((r) => r.request_class === 'background').length;

  const totalOk = used < REQUEST_BUDGET_PER_DAY;
  const classOk = requestClass === 'interactive' ? totalOk : usedBackground < BACKGROUND_BUDGET_PER_DAY;
  const allowed = totalOk && classOk;

  let nextAvailableAt: string | null = null;
  if (!allowed) {
    const relevant = requestClass === 'background' && totalOk
      ? rows.filter((r) => r.request_class === 'background')
      : rows;
    const oldest = relevant[0]?.requested_at;
    nextAvailableAt = oldest ? new Date(Date.parse(oldest) + WINDOW_MS).toISOString() : null;
  }

  return {
    used,
    usedBackground,
    limit: REQUEST_BUDGET_PER_DAY,
    backgroundLimit: BACKGROUND_BUDGET_PER_DAY,
    allowed,
    nextAvailableAt,
  };
}

/** Count one upstream request, before it is sent. */
export async function recordRequestUsage(
  connectionId: string,
  requestClass: RequestClass,
  jobId: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('finance_request_usage').insert({
    connection_id: connectionId,
    job_id: jobId,
    request_class: requestClass,
    outcome: 'requested',
    requested_at: now.toISOString(),
  });
  if (error) throw new Error(`Could not record request usage: ${error.message}`);
}

export class BudgetExhaustedError extends Error {
  code = 'local_budget_exhausted' as const;
  nextAvailableAt: string | null;
  constructor(state: BudgetState) {
    super(
      `The daily request budget for this connection is used up (${state.used}/${state.limit}).` +
        (state.nextAvailableAt ? ` Next request possible at ${state.nextAvailableAt}.` : ''),
    );
    this.nextAvailableAt = state.nextAvailableAt;
  }
}
