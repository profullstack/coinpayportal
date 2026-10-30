import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { mutateBusinessTags } from '@/lib/business/service';
import { isValidCategory } from '@/lib/business/taxonomy';
import { findLinkedBusinesses } from '@/lib/fraud/linkage';

const REVIEW_STATUSES = new Set(['not_required', 'pending', 'approved', 'rejected']);

/**
 * GET /api/admin/businesses/[id] — one business plus the other accounts that
 * share an identity signal with it. The linkage is the point: a business only
 * looks clean until you see what else sits behind the same webhook host or
 * payout wallet.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: business, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const linkage = await findLinkedBusinesses(supabase, id).catch(() => null);

  // Name the linked businesses so the response is readable on its own.
  let linkedBusinesses: any[] = [];
  if (linkage && linkage.linkedBusinessIds.length > 0) {
    const { data } = await supabase
      .from('businesses')
      .select('id, name, category, risk_level, review_status, created_at, merchant_id')
      .in('id', linkage.linkedBusinessIds);
    linkedBusinesses = (data ?? []).map((b) => ({
      ...b,
      link: linkage.links.find((l) => l.businessId === b.id) ?? null,
    }));
  }

  return NextResponse.json(
    { business, linkage: linkage ?? null, linkedBusinesses },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * PATCH /api/admin/businesses/[id] — work the review queue.
 *
 * Accepts `review_status`, `category` and `tags`. Tag and category edits go
 * through the same path a merchant uses, so risk is re-derived; a review_status
 * change is the admin's verdict and is written as given.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();

  const updates: Record<string, unknown> = {};

  if (body.review_status !== undefined) {
    if (!REVIEW_STATUSES.has(body.review_status)) {
      return NextResponse.json({ error: 'Invalid review_status' }, { status: 400 });
    }
    updates.review_status = body.review_status;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'active must be true or false' }, { status: 400 });
    }
    updates.active = body.active;
  }

  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    updates.category = body.category;
  }

  if (body.tags !== undefined && !Array.isArray(body.tags)) {
    return NextResponse.json({ error: 'tags must be an array' }, { status: 400 });
  }
  if (Object.keys(updates).length === 0 && body.tags === undefined) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
  }

  // Tags first: that write reclassifies, and an explicit review verdict in the
  // same request must survive it.
  if (Array.isArray(body.tags)) {
    const result = await mutateBusinessTags(supabase, id, 'replace', body.tags);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('businesses').update(updates).eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const { data: business, error } = await supabase.from('businesses').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not verify the saved business. Refresh before trying again.' }, { status: 500 });
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  return NextResponse.json({ success: true, business }, { headers: { 'Cache-Control': 'no-store' } });
}
