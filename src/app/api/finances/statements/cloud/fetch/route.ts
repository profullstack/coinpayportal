import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { enqueueStatementFetch, requireCloudStatements } from '@/lib/finances/cloud-statements';
import { listBankSessions } from '@/lib/finances/bank-sessions';
import { toPublicJob } from '@/lib/finances/jobs';
import { cloudError, INSTITUTION_KEY } from '@/lib/finances/cloud-api';
import { financeError, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/statements/cloud/fetch — fetch new statements now, in
 * CoinPay cloud, for one connected bank (`{institutionKey}`) or all of them.
 * Answers the queued jobs; poll /api/finances/jobs/:id or the fetch runs.
 */
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  let body: { institutionKey?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body means every connected bank.
  }
  const key = typeof body.institutionKey === 'string' ? body.institutionKey : null;
  if (key !== null && !INSTITUTION_KEY.test(key)) return financeError('invalid_request', 'institutionKey must be a bank key such as "chase"', 400);
  try {
    await requireCloudStatements(guard);
    const sessions = (await listBankSessions(guard.id)).filter((s) => s.object_key && (key === null || s.institution_key === key));
    if (!sessions.length) {
      return financeError('not_found', key ? `${key} is not connected to CoinPay cloud; connect it first` : 'No bank is connected to CoinPay cloud yet', 404);
    }
    const jobs = [];
    for (const session of sessions) jobs.push(await enqueueStatementFetch(guard.id, session.institution_key));
    return financeJson({ jobs: jobs.map(toPublicJob) }, 202);
  } catch (err) {
    return cloudError(err, 'Could not queue the fetch');
  }
}
