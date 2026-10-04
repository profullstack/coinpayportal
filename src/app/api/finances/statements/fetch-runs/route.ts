import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { FetchRunError, latestByInstitution, listFetchRuns, parseFetchRun, recordFetchRun, toPublicRun } from '@/lib/finances/statement-fetch';
import { financeError, financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/statements/fetch-runs — the latest statement fetch per
 * bank (`latest`) and the recent history (`runs`).
 */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const parsed = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '', 10);
  try {
    const runs = await listFetchRuns(guard.id, { limit: Number.isFinite(parsed) ? parsed : 200 });
    return financeJson({ latest: latestByInstitution(runs).map(toPublicRun), runs: runs.map(toPublicRun) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list statement fetch runs');
  }
}

/**
 * POST /api/finances/statements/fetch-runs — a fetcher reports one bank's
 * run: JSON `{institutionKey, institutionLabel?, status, candidates, filed,
 * duplicates, unmatched, silent, message?, client?, startedAt, finishedAt}`.
 * Counts and a short message only; no URL, cookie or page content.
 */
export async function POST(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.write', { write: true });
  if (guard instanceof NextResponse) return guard;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return financeError('invalid_request', 'Expected a JSON body', 400);
  }
  try {
    const run = await recordFetchRun(guard, parseFetchRun(body));
    return financeJson({ run: toPublicRun(run) }, 201);
  } catch (err) {
    if (err instanceof FetchRunError) return financeError('invalid_request', err.message, 400);
    return financeErrorFromException(err, 'Could not record the fetch run');
  }
}
