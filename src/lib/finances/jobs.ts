import 'server-only';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../supabase/server';
import { resolvePeriod, boundPeriod, planFetchWindows, PeriodError, type FetchWindowPlan } from './periods';
import { checkRequestBudget, type RequestClass } from './budget';
import { fetchForConnection, ingestAccountSet, lifecycleStateFor, getConnection, DEFAULT_SYNC_DAYS, type SyncResult } from './sync';
import { ProviderRequestError } from './simplefin';
import { redactAccessUrl } from './simplefin';

/**
 * Durable finance jobs.
 *
 * A job is a row in `finance_jobs`; a worker claims it through
 * `finance_claim_job()` (SELECT ... FOR UPDATE SKIP LOCKED) and gets back a
 * `lease_version`. Every write the worker makes afterwards carries that
 * version in its WHERE clause. If the lease expired and another worker
 * claimed the job, the version moved on, the stale write matches nothing,
 * and the stale worker stops. That is the whole fencing story; there is no
 * Redis and no in-memory state that matters.
 *
 * Work is resumable at window granularity. A backfill is planned into
 * calendar-month chunks at creation; `progress.windowsDone` lists which have
 * been ingested. A worker that dies mid-job leaves the finished chunks
 * recorded and the next claimant carries on from the first unfinished one —
 * ingestion is idempotent, so even a chunk that was fetched and not recorded
 * costs a request, never a duplicate row.
 *
 * The provider budget is checked before every request and counted for every
 * request. When it is gone the job parks itself as `waiting_for_budget` with
 * `run_after` set to when the oldest counted request ages out.
 */

export type JobKind = 'backfill' | 'refresh' | 'scheduled_sync' | 'report';
export type JobStatus = 'queued' | 'running' | 'waiting_for_budget' | 'partial' | 'failed' | 'completed' | 'cancelled';

export interface FinanceJobRow {
  id: string;
  merchant_id: string;
  connection_id: string | null;
  kind: JobKind;
  params: Record<string, unknown>;
  status: JobStatus;
  progress: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  lease_version: number;
  cancel_requested: boolean;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const JOB_COLUMNS =
  'id, merchant_id, connection_id, kind, params, status, progress, result, error_code, error_message, attempts, max_attempts, run_after, lease_owner, lease_expires_at, lease_version, cancel_requested, idempotency_key, created_at, updated_at, started_at, finished_at';

/** Seconds a claim holds a job before another worker may take it over. */
const LEASE_SECONDS = 300;

export class JobConflictError extends Error {
  code = 'idempotency_conflict' as const;
}

export class LeaseLostError extends Error {
  code = 'lease_lost' as const;
}

/** Shape of a job as returned to clients: no lease internals. */
export function toPublicJob(job: FinanceJobRow) {
  return {
    id: job.id,
    kind: job.kind,
    connectionId: job.connection_id,
    status: job.status,
    params: job.params,
    progress: job.progress,
    result: job.result,
    errorCode: job.error_code,
    errorMessage: job.error_message,
    attempts: job.attempts,
    nextAttemptAt: job.status === 'queued' || job.status === 'waiting_for_budget' ? job.run_after : null,
    cancelRequested: job.cancel_requested,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    updatedAt: job.updated_at,
  };
}

export async function getJob(jobId: string, merchantId: string): Promise<FinanceJobRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_jobs')
    .select(JOB_COLUMNS)
    .eq('id', jobId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the job: ${error.message}`);
  return (data as FinanceJobRow | null) ?? null;
}

export async function listJobs(
  merchantId: string,
  { limit = 50, connectionId }: { limit?: number; connectionId?: string | null } = {},
): Promise<FinanceJobRow[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('finance_jobs')
    .select(JOB_COLUMNS)
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (connectionId) query = query.eq('connection_id', connectionId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not list jobs: ${error.message}`);
  return (data ?? []) as FinanceJobRow[];
}

/**
 * Create a job, honouring an idempotency key scoped to merchant and kind. The
 * same key with the same params returns the existing job; the same key with
 * different params is a conflict.
 */
export async function createJob(params: {
  merchantId: string;
  kind: JobKind;
  connectionId?: string | null;
  params: Record<string, unknown>;
  idempotencyKey?: string | null;
  runAfter?: Date;
}): Promise<FinanceJobRow> {
  const supabase = getSupabaseAdmin();
  const key = params.idempotencyKey?.trim() || null;

  if (key) {
    const { data: existing, error } = await supabase
      .from('finance_jobs')
      .select(JOB_COLUMNS)
      .eq('merchant_id', params.merchantId)
      .eq('kind', params.kind)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw new Error(`Could not check the idempotency key: ${error.message}`);
    if (existing) {
      const row = existing as FinanceJobRow;
      if (JSON.stringify(row.params) !== JSON.stringify(params.params)) {
        throw new JobConflictError('This Idempotency-Key was already used with a different request');
      }
      return row;
    }
  }

  const { data, error } = await supabase
    .from('finance_jobs')
    .insert({
      merchant_id: params.merchantId,
      connection_id: params.connectionId ?? null,
      kind: params.kind,
      params: params.params,
      idempotency_key: key,
      run_after: (params.runAfter ?? new Date()).toISOString(),
    })
    .select(JOB_COLUMNS)
    .single();
  if (error) {
    if (/duplicate key/i.test(error.message) && key) {
      const again = await createJob({ ...params, idempotencyKey: key });
      return again;
    }
    throw new Error(`Could not create the job: ${error.message}`);
  }
  return data as FinanceJobRow;
}

/** Ask a job to stop. Queued work is cancelled at once; running work at its next checkpoint. */
export async function cancelJob(jobId: string, merchantId: string): Promise<FinanceJobRow | null> {
  const supabase = getSupabaseAdmin();
  const job = await getJob(jobId, merchantId);
  if (!job) return null;
  if (['completed', 'failed', 'cancelled', 'partial'].includes(job.status)) return job;

  const now = new Date().toISOString();
  const patch =
    job.status === 'running'
      ? { cancel_requested: true, updated_at: now }
      : { cancel_requested: true, status: 'cancelled', finished_at: now, updated_at: now };
  const { data, error } = await supabase
    .from('finance_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('merchant_id', merchantId)
    .select(JOB_COLUMNS)
    .single();
  if (error) throw new Error(`Could not cancel the job: ${error.message}`);
  return data as FinanceJobRow;
}

export interface BackfillRequest {
  merchantId: string;
  connectionId?: string | null;
  period?: string | null;
  from?: string | null;
  to?: string | null;
  timezone: string;
  idempotencyKey?: string | null;
}

/**
 * Queue a period backfill. One job per connection; when no connection is
 * named, every active one gets a job. The windows are planned now so the
 * job's request cost is visible before it runs.
 *
 * @throws {PeriodError} for a bad selector or a future period
 */
export async function createBackfillJobs(req: BackfillRequest): Promise<FinanceJobRow[]> {
  const period = resolvePeriod({ period: req.period, from: req.from, to: req.to, timezone: req.timezone });
  const bounded = boundPeriod(period, new Date());
  const windows = planFetchWindows(period, { cutoff: new Date(bounded.effectiveEnd) });
  if (windows.length === 0) throw new PeriodError('Nothing to fetch for this period');

  const supabase = getSupabaseAdmin();
  let connectionIds: string[];
  if (req.connectionId) {
    const conn = await getConnection(req.connectionId, req.merchantId);
    if (!conn) throw new Error('Finance connection not found');
    if (conn.lifecycle_state === 'disconnected') throw new Error('This connection is disconnected');
    connectionIds = [conn.id];
  } else {
    const { data, error } = await supabase
      .from('finance_connections')
      .select('id')
      .eq('merchant_id', req.merchantId)
      .eq('is_active', true)
      .neq('lifecycle_state', 'disconnected');
    if (error) throw new Error(`Could not list connections: ${error.message}`);
    connectionIds = (data ?? []).map((r) => r.id as string);
    if (connectionIds.length === 0) throw new Error('No active finance connection to backfill');
  }

  const jobs: FinanceJobRow[] = [];
  for (const connectionId of connectionIds) {
    jobs.push(
      await createJob({
        merchantId: req.merchantId,
        kind: 'backfill',
        connectionId,
        params: {
          period: period.selector,
          periodLabel: period.label,
          timezone: period.timezone,
          start: period.start,
          end: period.end,
          effectiveEnd: bounded.effectiveEnd,
          periodToDate: bounded.periodToDate,
          windows,
          requestsPlanned: windows.length,
        },
        idempotencyKey: req.idempotencyKey ? `${req.idempotencyKey}:${connectionId}` : null,
      }),
    );
  }
  return jobs;
}

/** Queue a rolling refresh of one connection in the background. */
export async function createRefreshJob(params: {
  merchantId: string;
  connectionId: string;
  days?: number;
  kind?: 'refresh' | 'scheduled_sync';
  idempotencyKey?: string | null;
}): Promise<FinanceJobRow> {
  const conn = await getConnection(params.connectionId, params.merchantId);
  if (!conn) throw new Error('Finance connection not found');
  const days = Math.min(Math.max(Math.floor(params.days ?? DEFAULT_SYNC_DAYS), 1), 89);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const window: FetchWindowPlan = {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    start: start.toISOString(),
    end: end.toISOString(),
    days,
  };
  return createJob({
    merchantId: params.merchantId,
    kind: params.kind ?? 'refresh',
    connectionId: params.connectionId,
    params: { days, windows: [window], requestsPlanned: 1, rolling: true },
    idempotencyKey: params.idempotencyKey ?? null,
  });
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/** Write to a job only if this worker still holds the lease. */
async function fencedUpdate(
  jobId: string,
  leaseVersion: number,
  patch: Record<string, unknown>,
): Promise<FinanceJobRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('lease_version', leaseVersion)
    .select(JOB_COLUMNS);
  if (error) throw new Error(`Could not update the job: ${error.message}`);
  if (!data || data.length === 0) {
    throw new LeaseLostError(`Job ${jobId} lease ${leaseVersion} is no longer held by this worker`);
  }
  return data[0] as FinanceJobRow;
}

/** Extend the lease and pick up a cancellation request. */
async function heartbeat(job: FinanceJobRow): Promise<FinanceJobRow> {
  return fencedUpdate(job.id, job.lease_version, {
    lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
  });
}

/** Bounded exponential backoff with jitter, in milliseconds. */
export function backoffMs(attempt: number, { baseMs = 60_000, maxMs = 6 * 3600_000 } = {}): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = exp * (0.5 + Math.random() * 0.5);
  return Math.min(maxMs, Math.round(jitter));
}

async function releaseWithStatus(
  job: FinanceJobRow,
  status: JobStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const finished = ['completed', 'failed', 'cancelled', 'partial'].includes(status);
  await fencedUpdate(job.id, job.lease_version, {
    status,
    lease_owner: null,
    lease_expires_at: null,
    ...(finished ? { finished_at: new Date().toISOString() } : {}),
    ...extra,
  });
}

interface SyncProgress {
  windowsDone: number[];
  windowsPartial: number[];
  windowsFailed: number[];
  requestsMade: number;
  lastError: string | null;
  summaries: Array<{ index: number; accounts: number; transactionsSeen: number; transactionsNew: number; status: string; capped: boolean }>;
}

function readProgress(job: FinanceJobRow): SyncProgress {
  const p = (job.progress ?? {}) as Partial<SyncProgress>;
  return {
    windowsDone: Array.isArray(p.windowsDone) ? p.windowsDone : [],
    windowsPartial: Array.isArray(p.windowsPartial) ? p.windowsPartial : [],
    windowsFailed: Array.isArray(p.windowsFailed) ? p.windowsFailed : [],
    requestsMade: typeof p.requestsMade === 'number' ? p.requestsMade : 0,
    lastError: typeof p.lastError === 'string' ? p.lastError : null,
    summaries: Array.isArray(p.summaries) ? p.summaries : [],
  };
}

/**
 * Run one sync-shaped job (backfill, refresh, scheduled_sync) to its next
 * stopping point: done, out of budget, cancelled, failed, or lease lost.
 */
async function runSyncJob(initial: FinanceJobRow): Promise<void> {
  let job = initial;
  if (!job.connection_id) {
    await releaseWithStatus(job, 'failed', { error_code: 'invalid_job', error_message: 'Sync job has no connection' });
    return;
  }
  const connectionId: string = job.connection_id;
  const windows = (job.params.windows as FetchWindowPlan[] | undefined) ?? [];
  const progress = readProgress(job);
  const requestClass: RequestClass = 'background';

  for (let index = 0; index < windows.length; index += 1) {
    if (progress.windowsDone.includes(index)) continue;

    // Checkpoint: extend the lease and observe cancellation.
    job = await heartbeat(job);
    if (job.cancel_requested) {
      await releaseWithStatus(job, 'cancelled', { progress });
      return;
    }

    const budget = await checkRequestBudget(connectionId, requestClass);
    if (!budget.allowed) {
      const runAfter = budget.nextAvailableAt ?? new Date(Date.now() + 3600_000).toISOString();
      await releaseWithStatus(job, 'waiting_for_budget', {
        run_after: runAfter,
        progress: { ...progress, budget: { used: budget.used, limit: budget.limit } },
      });
      return;
    }

    const window = windows[index];
    let result: SyncResult;
    try {
      progress.requestsMade += 1;
      const fetched = await fetchForConnection(connectionId, job.merchant_id, {
        start: new Date(window.start),
        end: new Date(window.end),
        requestClass,
        jobId: job.id,
      });
      result = await ingestAccountSet({
        connectionId,
        merchantId: job.merchant_id,
        provider: fetched.provider,
        set: fetched.set,
        window: { start: new Date(window.start), end: new Date(window.end) },
        jobId: job.id,
        requestClass,
      });
    } catch (err) {
      if (err instanceof LeaseLostError) throw err;
      const message = redactAccessUrl(err instanceof Error ? err.message : 'Unknown failure').slice(0, 1000);
      progress.lastError = message;

      if (err instanceof ProviderRequestError && err.code === 'provider_rate_limited') {
        const wait = err.retryAfterMs ?? 3600_000;
        await releaseWithStatus(job, 'waiting_for_budget', {
          run_after: new Date(Date.now() + wait).toISOString(),
          progress,
        });
        return;
      }
      const lifecycle = lifecycleStateFor(err);
      if (lifecycle) {
        await getSupabaseAdmin()
          .from('finance_connections')
          .update({ lifecycle_state: lifecycle, last_sync_status: 'error', last_sync_error: message })
          .eq('id', connectionId)
          .eq('merchant_id', job.merchant_id);
        await releaseWithStatus(job, 'failed', {
          error_code: (err as ProviderRequestError).code,
          error_message: message,
          progress,
        });
        return;
      }
      if (job.attempts < job.max_attempts) {
        await releaseWithStatus(job, 'queued', {
          run_after: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
          progress,
          error_message: message,
        });
        return;
      }
      progress.windowsFailed.push(index);
      await releaseWithStatus(job, 'failed', { error_code: 'provider_error', error_message: message, progress });
      return;
    }

    progress.windowsDone.push(index);
    if (result.status === 'partial') progress.windowsPartial.push(index);
    progress.summaries.push({
      index,
      accounts: result.accounts,
      transactionsSeen: result.transactionsSeen,
      transactionsNew: result.transactionsNew,
      status: result.status,
      capped: result.capped,
    });
    job = await fencedUpdate(job.id, job.lease_version, { progress, error_message: null });
  }

  const partial = progress.windowsPartial.length > 0;
  await getSupabaseAdmin()
    .from('finance_connections')
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: partial ? 'partial' : 'ok',
      last_sync_error: partial ? progress.lastError : null,
      lifecycle_state: 'active',
    })
    .eq('id', connectionId)
    .eq('merchant_id', job.merchant_id);

  await releaseWithStatus(job, partial ? 'partial' : 'completed', {
    progress,
    result: {
      windows: windows.length,
      windowsDone: progress.windowsDone.length,
      windowsPartial: progress.windowsPartial.length,
      requestsMade: progress.requestsMade,
      transactionsNew: progress.summaries.reduce((a, s) => a + s.transactionsNew, 0),
      transactionsSeen: progress.summaries.reduce((a, s) => a + s.transactionsSeen, 0),
      capped: progress.summaries.some((s) => s.capped),
    },
  });
}

async function runReportJob(job: FinanceJobRow): Promise<void> {
  // Reports import this module for queueing; load lazily to avoid a cycle.
  const { generateReport } = await import('./reports');
  const reportId = job.params.reportId as string | undefined;
  if (!reportId) {
    await releaseWithStatus(job, 'failed', { error_code: 'invalid_job', error_message: 'Report job has no report id' });
    return;
  }
  try {
    const outcome = await generateReport(reportId, job.merchant_id, {
      heartbeat: async () => {
        job = await heartbeat(job);
        return !job.cancel_requested;
      },
    });
    await releaseWithStatus(job, outcome.ok ? 'completed' : 'failed', {
      result: outcome.summary,
      error_code: outcome.ok ? null : outcome.errorCode,
      error_message: outcome.ok ? null : outcome.errorMessage,
    });
  } catch (err) {
    if (err instanceof LeaseLostError) throw err;
    const message = err instanceof Error ? err.message : 'Report generation failed';
    if (job.attempts < job.max_attempts) {
      await releaseWithStatus(job, 'queued', {
        run_after: new Date(Date.now() + backoffMs(job.attempts, { baseMs: 15_000 })).toISOString(),
        error_message: message.slice(0, 1000),
      });
    } else {
      await releaseWithStatus(job, 'failed', { error_code: 'report_failed', error_message: message.slice(0, 1000) });
    }
  }
}

/**
 * Turn daily-sync consent into work. A connection whose `next_sync_at` has
 * passed gets one `scheduled_sync` job, and its next slot moves a day on.
 * Nothing is enqueued for a connection with a job already in flight.
 */
export async function enqueueScheduledSyncs(now: Date = new Date()): Promise<number> {
  if (process.env.FINANCES_SCHEDULED_SYNC_ENABLED === 'false') return 0;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('finance_connections')
    .select('id, merchant_id, next_sync_at, sync_minute')
    .not('sync_consent_at', 'is', null)
    .eq('lifecycle_state', 'active')
    .eq('is_active', true)
    .lte('next_sync_at', now.toISOString())
    .limit(100);
  if (error) throw new Error(`Could not read scheduled connections: ${error.message}`);

  let created = 0;
  for (const row of data ?? []) {
    const { count } = await supabase
      .from('finance_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', row.id as string)
      .in('status', ['queued', 'running', 'waiting_for_budget']);
    const next = new Date(now);
    next.setUTCHours(0, 0, 0, 0);
    next.setUTCMinutes((row.sync_minute as number | null) ?? 0);
    while (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    await supabase.from('finance_connections').update({ next_sync_at: next.toISOString() }).eq('id', row.id as string);
    if ((count ?? 0) > 0) continue;
    await createRefreshJob({
      merchantId: row.merchant_id as string,
      connectionId: row.id as string,
      kind: 'scheduled_sync',
      idempotencyKey: `scheduled:${row.id}:${now.toISOString().slice(0, 10)}`,
    });
    created += 1;
  }
  return created;
}

export interface WorkerTickResult {
  workerId: string;
  claimed: number;
  scheduled: number;
  errors: string[];
}

/**
 * Claim and run due jobs until none are left or the deadline passes. Safe to
 * call from several processes at once.
 */
export async function runWorkerTick({
  workerId = `worker-${randomUUID().slice(0, 8)}`,
  maxJobs = 10,
  deadlineMs = 240_000,
  kinds = null as JobKind[] | null,
}: { workerId?: string; maxJobs?: number; deadlineMs?: number; kinds?: JobKind[] | null } = {}): Promise<WorkerTickResult> {
  const supabase = getSupabaseAdmin();
  const startedAt = Date.now();
  const result: WorkerTickResult = { workerId, claimed: 0, scheduled: 0, errors: [] };

  try {
    result.scheduled = await enqueueScheduledSyncs();
  } catch (err) {
    result.errors.push(`schedule: ${err instanceof Error ? err.message : String(err)}`);
  }

  while (result.claimed < maxJobs && Date.now() - startedAt < deadlineMs) {
    const { data, error } = await supabase.rpc('finance_claim_job', {
      p_worker: workerId,
      p_lease_seconds: LEASE_SECONDS,
      p_kinds: kinds,
    });
    if (error) {
      result.errors.push(`claim: ${error.message}`);
      break;
    }
    const rows = (data ?? []) as FinanceJobRow[];
    if (rows.length === 0) break;
    const job = rows[0];
    result.claimed += 1;

    try {
      if (job.kind === 'report') await runReportJob(job);
      else await runSyncJob(job);
    } catch (err) {
      if (err instanceof LeaseLostError) {
        result.errors.push(`lease lost on ${job.id}`);
        continue;
      }
      const message = redactAccessUrl(err instanceof Error ? err.message : String(err)).slice(0, 1000);
      result.errors.push(`${job.id}: ${message}`);
      try {
        await fencedUpdate(job.id, job.lease_version, {
          status: job.attempts < job.max_attempts ? 'queued' : 'failed',
          run_after: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
          error_code: 'worker_error',
          error_message: message,
          lease_owner: null,
          lease_expires_at: null,
        });
      } catch {
        // Lease already gone; another worker owns the job now.
      }
    }
  }
  return result;
}

let loopTimer: NodeJS.Timeout | null = null;
let loopRunning = false;

/** In-process worker loop for the Next.js server, started from instrumentation. */
export function startFinanceWorkerLoop(intervalMs = 30_000): void {
  if (loopTimer) return;
  const workerId = `next-${process.pid}-${randomUUID().slice(0, 6)}`;
  const tick = async () => {
    if (loopRunning) return;
    loopRunning = true;
    try {
      const r = await runWorkerTick({ workerId, maxJobs: 5, deadlineMs: intervalMs * 4 });
      if (r.claimed > 0 || r.errors.length > 0) {
        console.log(`[finance-worker] ${workerId} claimed=${r.claimed} scheduled=${r.scheduled} errors=${r.errors.length}`);
        for (const e of r.errors) console.error(`[finance-worker] ${e}`);
      }
    } catch (err) {
      console.error('[finance-worker] tick failed', err instanceof Error ? err.message : err);
    } finally {
      loopRunning = false;
    }
  };
  loopTimer = setInterval(tick, intervalMs);
  void tick();
  console.log(`[finance-worker] started (${workerId}, every ${intervalMs}ms)`);
}

export function stopFinanceWorkerLoop(): void {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
}
