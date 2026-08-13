import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { applyBusinessFilters } from '@/lib/business/service';

const SORTABLE = new Set(['created_at', 'name', 'risk_level', 'review_status', 'category']);

/**
 * GET /api/admin/businesses — every business on the platform.
 *
 * This is other merchants' data, so `requireAdmin` is the whole security
 * boundary. Supports the same search and facet params as the merchant list,
 * plus owner email and pagination.
 *
 * ?search= &tag= &category= &risk= &review= &sort= &dir= &limit= &offset=
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const params = req.nextUrl.searchParams;
  const sort = SORTABLE.has(params.get('sort') ?? '') ? params.get('sort')! : 'created_at';
  const ascending = params.get('dir') === 'asc';

  const parsedLimit = Number.parseInt(params.get('limit') ?? '', 10);
  const parsedOffset = Number.parseInt(params.get('offset') ?? '', 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 50;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  try {
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('businesses')
      .select(
        'id, name, description, category, tags, risk_level, risk_flags, review_status, active, created_at, merchant_id, webhook_url',
        { count: 'exact' }
      );

    query = applyBusinessFilters(query, {
      search: params.get('search'),
      tags: params.getAll('tag'),
      category: params.get('category'),
      riskLevel: params.get('risk'),
      reviewStatus: params.get('review'),
    });

    const { data, error, count } = await query
      .order(sort, { ascending })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[admin/businesses] query failed', error);
      return NextResponse.json({ error: 'Failed to load businesses' }, { status: 500 });
    }

    // Attach the owner's email so an admin can see who is behind each one.
    const merchantIds = [...new Set((data ?? []).map((b) => b.merchant_id).filter(Boolean))];
    const ownerEmails = new Map<string, string>();
    if (merchantIds.length > 0) {
      const { data: merchants } = await supabase
        .from('merchants')
        .select('id, email')
        .in('id', merchantIds);
      for (const m of merchants ?? []) ownerEmails.set(m.id, m.email);
    }

    const businesses = (data ?? []).map((b) => ({
      ...b,
      owner_email: b.merchant_id ? ownerEmails.get(b.merchant_id) ?? null : null,
    }));

    return NextResponse.json(
      { businesses, total: count ?? 0, limit, offset, sort, dir: ascending ? 'asc' : 'desc' },
      // Never cache: platform-wide data about every merchant.
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[admin/businesses] failed', err);
    return NextResponse.json({ error: 'Failed to load businesses' }, { status: 500 });
  }
}
