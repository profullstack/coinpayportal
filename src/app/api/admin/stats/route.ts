import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getAdminPlatformStats } from '@/lib/stats/admin-platform-series';

/**
 * GET /api/admin/stats — platform-wide volume, commission and status figures.
 *
 * Every number here spans all merchants, so `requireAdmin` is the entire
 * security boundary. `?days=` scopes the chart window only; the commission
 * summary is always lifetime.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const parsedDays = Number.parseInt(req.nextUrl.searchParams.get('days') ?? '', 10);
  const days = Number.isFinite(parsedDays) ? parsedDays : 30;

  try {
    const stats = await getAdminPlatformStats(days);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[admin/stats] failed', error);
    return NextResponse.json({ error: 'Failed to load platform stats' }, { status: 500 });
  }
}
