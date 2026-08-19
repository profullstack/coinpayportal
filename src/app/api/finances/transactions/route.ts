import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { listTransactions } from '@/lib/finances/summary';

export const dynamic = 'force-dynamic';

/** A date param, or null when absent or unparseable. */
function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * GET /api/finances/transactions — the ledger, newest first.
 *
 * Filters: `account`, `search`, `category` (`uncategorised` for the null
 * bucket), `start`, `end`, `pending=0`, plus `limit`/`offset`.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const params = req.nextUrl.searchParams;

  const parsedLimit = Number.parseInt(params.get('limit') ?? '', 10);
  const parsedOffset = Number.parseInt(params.get('offset') ?? '', 10);

  try {
    const page = await listTransactions({
      accountId: params.get('account'),
      search: params.get('search'),
      category: params.get('category'),
      startDate: parseDate(params.get('start')),
      endDate: parseDate(params.get('end')),
      includePending: params.get('pending') !== '0',
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
    });

    return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[finances/transactions] failed', err);
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
  }
}
