import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { getSummary } from '@/lib/finances/summary';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/summary — balance sheet and cashflow headline.
 *
 * Somebody's bank balances, so the guard plus the `merchantId` scope is the
 * entire security boundary: the tables are RLS-enabled with no policies and
 * are reachable only through the service client behind this route.
 *
 * `?days=` sets the cashflow and category window. Balances ignore it — a
 * balance is a current fact and has no window.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const params = req.nextUrl.searchParams;
  const parsedDays = Number.parseInt(params.get('days') ?? '', 10);
  const windowDays = Number.isFinite(parsedDays) ? parsedDays : 30;
  const includeHidden = params.get('hidden') === '1';

  try {
    const summary = await getSummary(guard.id, { windowDays, includeHidden });
    return NextResponse.json(
      { summary },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[finances/summary] failed', err);
    return NextResponse.json({ error: 'Failed to load finance summary' }, { status: 500 });
  }
}
