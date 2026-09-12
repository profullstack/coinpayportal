import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { getJob, toPublicJob } from '@/lib/finances/jobs';
import { financeError, financeErrorFromException, financeJson, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/jobs/[id] — progress, coverage counts and the next
 * attempt time. Reading a job never touches the provider.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return financeError('not_found', 'Job not found', 404);
  try {
    const job = await getJob(id, guard.id);
    if (!job) return financeError('not_found', 'Job not found', 404);
    return financeJson({ job: toPublicJob(job) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not read the job');
  }
}
