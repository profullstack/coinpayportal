import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { finishLiveSession } from '@/lib/finances/cloud-browser';
import { enqueueStatementFetch } from '@/lib/finances/cloud-statements';
import { liveStatus } from '@/lib/finances/cloud-browser';
import { toPublicJob } from '@/lib/finances/jobs';
import { cloudError } from '@/lib/finances/cloud-api';
import { financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/statements/cloud/live/:id/save — keep the bank session
 * (cookies and site storage, sealed), close the cloud browser, and queue the
 * first fetch. Finish on the page that lists statements: it becomes where
 * every fetch starts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    const { institutionKey } = liveStatus(id, guard.id);
    const saved = await finishLiveSession(id, guard, true);
    const job = await enqueueStatementFetch(guard.id, institutionKey, { reason: 'connected' });
    return financeJson({ ...saved, institutionKey, job: toPublicJob(job) });
  } catch (err) {
    return cloudError(err, 'Could not save the bank session');
  }
}
