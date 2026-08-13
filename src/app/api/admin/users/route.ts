import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import {
  getAdminPlatformStats,
  getAdminUserStats,
  parseSortDirection,
  parseSortKey,
} from '@/lib/stats/admin-user-stats';

/**
 * GET /api/admin/users — per-user statistics for the admin console.
 *
 * Every row here is another merchant's business data, so the admin check is
 * the whole security boundary: the underlying Postgres functions are granted
 * to `service_role` only and are unreachable from a browser session.
 *
 * `?summary=0` skips the platform totals. The table refetches on every sort,
 * page and search change, and the totals do not vary with any of them.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const params = req.nextUrl.searchParams;
  const search = params.get('search');
  const sort = parseSortKey(params.get('sort'));
  const direction = parseSortDirection(params.get('dir'));

  // Clamped again in SQL; parsed here so a non-numeric ?limit=abc becomes the
  // default rather than NaN.
  const parsedLimit = Number.parseInt(params.get('limit') ?? '', 10);
  const parsedOffset = Number.parseInt(params.get('offset') ?? '', 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 50;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const wantsSummary = params.get('summary') !== '0';

  try {
    const [page, summary] = await Promise.all([
      getAdminUserStats({ search, sort, direction, limit, offset }),
      wantsSummary ? getAdminPlatformStats() : Promise.resolve(null),
    ]);

    return NextResponse.json(
      { users: page.rows, total: page.total, limit: page.limit, offset: page.offset, sort, dir: direction, summary },
      // Never cache: this is per-admin data about every user on the platform.
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[admin/users] failed to load stats', err);
    return NextResponse.json({ error: 'Failed to load user stats' }, { status: 500 });
  }
}
