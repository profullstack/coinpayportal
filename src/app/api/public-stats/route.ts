import { NextResponse } from 'next/server';
import { getPublicStats } from '@/lib/stats/public-stats';

/**
 * GET /api/public-stats — the hero counters.
 *
 * Exists because the landing page could not read them itself. The page is
 * prerendered during `pnpm build`, and the Dockerfile only forwards
 * `NEXT_PUBLIC_*` build args — `SUPABASE_SERVICE_ROLE_KEY` is deliberately not
 * among them, since baking a service key into an image layer would be worse
 * than a missing statistic. So the build-time render always failed closed and
 * the homepage shipped with no stats at all.
 *
 * A route handler runs at request time, where the key is present. That keeps
 * the landing page fully static — it is the marketing page, and per-request
 * rendering of it to fetch three integers would be a poor trade — while the
 * numbers stay live.
 *
 * No authentication: this publishes exactly what the homepage publishes. The
 * underlying Postgres function stays `service_role`-only so the browser reaches
 * these figures through here rather than through PostgREST, where an anonymous
 * caller would run it under RLS and receive a well-formed set of zeros.
 */
export async function GET() {
  const stats = await getPublicStats();

  if (!stats) {
    // 503 rather than 200-with-nulls: the client renders nothing on failure,
    // and a caching layer should not memoise an absence as though it were data.
    return NextResponse.json(
      { success: false, error: 'Stats temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { success: true, stats },
    {
      // The counters move slowly; five minutes at the edge keeps the database
      // out of the request path for essentially every visitor.
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
    },
  );
}
