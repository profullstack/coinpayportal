import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { getStatementCoverage, latestByInstitution, listFetchRuns, toPublicRun } from '@/lib/finances/statement-fetch';
import { financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/statements/coverage?months=12 — per account, which of
 * the last N months have a statement in the library (`have`), which do not
 * (`missing`), and the current month (`open`), plus the latest fetch run
 * per bank so a missing month can be read beside "needs signing in".
 */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const parsed = Number.parseInt(req.nextUrl.searchParams.get('months') ?? '', 10);
  const months = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 36) : 12;
  try {
    const [coverage, runs] = await Promise.all([getStatementCoverage(guard.id, months), listFetchRuns(guard.id, { limit: 200 })]);
    const missing = coverage.accounts.reduce((sum, account) => sum + account.missing, 0);
    return financeJson({ ...coverage, missing, fetchers: latestByInstitution(runs).map(toPublicRun) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not compute statement coverage');
  }
}
