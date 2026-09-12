import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { createBackfillJobs, createRefreshJob, toPublicJob } from '@/lib/finances/jobs';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException, financeJson, idempotencyKeyFrom, isUuid, readJsonBody } from '@/lib/finances/api';
import { audit } from '@/lib/finances/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/sync-jobs — queue a period backfill or a background
 * refresh. Answers 202 with the job(s); nothing has been fetched yet.
 *
 * Body, backfill: `{ kind: "backfill", period?: "2026-Q2", from?, to?,
 * timezone?, connectionId? }`. Body, refresh: `{ kind: "refresh",
 * connectionId, days? }`. The existing POST /sync keeps its synchronous
 * contract; this is the asynchronous sibling.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;

  const body = await readJsonBody<{
    kind?: unknown;
    period?: unknown;
    from?: unknown;
    to?: unknown;
    timezone?: unknown;
    connectionId?: unknown;
    days?: unknown;
  }>(req);

  const kind = body.kind === 'refresh' ? 'refresh' : 'backfill';
  const connectionId = typeof body.connectionId === 'string' && body.connectionId ? body.connectionId : null;
  if (connectionId && !isUuid(connectionId)) return financeError('invalid_request', 'connectionId must be a uuid', 400);

  try {
    if (kind === 'refresh') {
      if (!connectionId) return financeError('invalid_request', 'A refresh needs a connectionId', 400);
      const parsedDays = Number.parseInt(String(body.days ?? ''), 10);
      const job = await createRefreshJob({
        merchantId: guard.id,
        connectionId,
        days: Number.isFinite(parsedDays) ? parsedDays : undefined,
        idempotencyKey: idempotencyKeyFrom(req),
      });
      await audit(guard.id, 'sync_job.create', 'job', job.id, { kind: 'refresh' });
      return financeJson({ jobs: [toPublicJob(job)], job: toPublicJob(job) }, 202);
    }

    const tz = await resolveFinanceTimezone(guard.id, body.timezone);
    if (!tz) {
      return financeError(
        'timezone_required',
        'No finance timezone is saved yet. Pass an IANA timezone such as America/Los_Angeles; it will be remembered.',
        400,
      );
    }

    const jobs = await createBackfillJobs({
      merchantId: guard.id,
      connectionId,
      period: typeof body.period === 'string' ? body.period : null,
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
      timezone: tz.timezone,
      idempotencyKey: idempotencyKeyFrom(req),
    });
    for (const job of jobs) {
      await audit(guard.id, 'sync_job.create', 'job', job.id, { kind: 'backfill', windows: (job.params.windows as unknown[]).length });
    }
    return financeJson({ jobs: jobs.map(toPublicJob), job: toPublicJob(jobs[0]), timezone: tz }, 202);
  } catch (err) {
    return financeErrorFromException(err, 'Could not queue the sync job');
  }
}
