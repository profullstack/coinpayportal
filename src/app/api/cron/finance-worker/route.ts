import { NextRequest, NextResponse } from 'next/server';
import { isCronSecret } from '@/lib/auth/secret-compare';
import { runWorkerTick } from '@/lib/finances/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/cron/finance-worker — one worker tick, for deployments that
 * drive the finance queue from a scheduler instead of the in-process loop.
 *
 * Claims due jobs (backfills, scheduled syncs, report generation) and runs
 * them until none are left or the tick's deadline passes. Each job records
 * its own progress, so a tick that ends mid-backfill is resumed by the next
 * one. Safe to run from several schedulers at once: claims are
 * `FOR UPDATE SKIP LOCKED` and every write is fenced by the lease version.
 */
async function handle(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!isCronSecret(auth.replace(/^Bearer\s+/i, ''))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await runWorkerTick({ deadlineMs: 240_000, maxJobs: 20 });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
