import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { buildHistory, type HistoryType } from '@/lib/finances/history';
import { financeErrorFromException, financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

const TYPES: HistoryType[] = ['generated', 'emailed', 'digest', 'uploaded'];

/**
 * GET /api/finances/history?type=generated,emailed,digest,uploaded&limit=200
 *
 * Every business report in one timeline: generated finance reports, emailed
 * reports and CPA packs (recipients, opens, expiry), queued or failed digests,
 * and uploaded documents. Newest first.
 */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;
  const types = (q.get('type') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is HistoryType => (TYPES as string[]).includes(t));
  const limit = Number(q.get('limit') ?? '200') || 200;
  try {
    const items = await buildHistory(guard.id, { limit, types });
    return financeJson({ items, role: guard.role });
  } catch (err) {
    return financeErrorFromException(err, 'Could not load the history');
  }
}
