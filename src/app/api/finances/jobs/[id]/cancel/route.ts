import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { cancelJob, toPublicJob } from '@/lib/finances/jobs';
import { financeError, financeErrorFromException, financeJson, isUuid } from '@/lib/finances/api';
import { auditFinance } from '@/lib/finances/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/jobs/[id]/cancel — stop queued work now, or ask running
 * work to stop at its next checkpoint (between provider requests).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Job not found', 404);
  try {
    const job = await cancelJob(id, guard.id);
    if (!job) return financeError('not_found', 'Job not found', 404);
    await auditFinance(guard, 'job.cancel', 'job', job.id, { status: job.status });
    return financeJson({ job: toPublicJob(job) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not cancel the job');
  }
}
