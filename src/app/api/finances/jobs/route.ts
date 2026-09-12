import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { listJobs, toPublicJob } from '@/lib/finances/jobs';
import { financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/** GET /api/finances/jobs — this merchant's recent jobs, newest first. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const params = req.nextUrl.searchParams;
  const parsedLimit = Number.parseInt(params.get('limit') ?? '', 10);
  try {
    const jobs = await listJobs(guard.id, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      connectionId: params.get('connection'),
    });
    return financeJson({ jobs: jobs.map(toPublicJob) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list jobs');
  }
}
