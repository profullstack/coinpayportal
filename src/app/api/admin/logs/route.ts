import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getEventLog } from '@/lib/stats/event-log';

/**
 * GET /api/admin/logs — the fraud/risk event log across every business.
 *
 * `businessIds: null` is the platform-wide scope and is only ever reachable
 * from behind `requireAdmin`. Buyer IPs are included here and withheld from
 * the merchant-facing equivalent.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const params = req.nextUrl.searchParams;
  const parsedLimit = Number.parseInt(params.get('limit') ?? '', 10);

  try {
    const log = await getEventLog({
      businessIds: null,
      kind: params.get('kind'),
      decision: params.get('decision'),
      search: params.get('search'),
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      includeIp: true,
    });
    return NextResponse.json(log, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[admin/logs] failed', error);
    return NextResponse.json({ error: 'Failed to load event log' }, { status: 500 });
  }
}
