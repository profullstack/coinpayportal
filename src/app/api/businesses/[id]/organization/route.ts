import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller } from '@/lib/team/api';
import { authorizeBusiness, authorizeOrg } from '@/lib/auth/authz';

/**
 * PATCH /api/businesses/[id]/organization  { organization_id: string | null }
 * Move a business into another organization (or null to ungroup). The caller must be
 * able to manage the business (admin+) and, when moving into an org, manage that org too.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeBusiness(supabase, caller.merchantId, id, 'business.update');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const organizationId: string | null =
    body?.organization_id === null || body?.organization_id === undefined
      ? null
      : String(body.organization_id);

  if (organizationId) {
    const orgAuth = await authorizeOrg(supabase, caller.merchantId, organizationId, 'settings.manage');
    if (!orgAuth.ok) {
      return NextResponse.json(
        { success: false, error: 'You cannot move a business into that organization' },
        { status: orgAuth.status },
      );
    }
  }

  const { error } = await supabase
    .from('businesses')
    .update({ organization_id: organizationId })
    .eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
