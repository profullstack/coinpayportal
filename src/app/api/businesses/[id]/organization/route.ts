import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveSessionCaller } from '@/lib/team/api';
import { authorizeBusiness, authorizeOrg } from '@/lib/auth/authz';

/**
 * PATCH /api/businesses/[id]/organization  { organization_id: string | null }
 * Move a business into another organization (or null to ungroup). OWNER ONLY on both
 * sides: the business's own merchant, moving it into an org they own. Every member of
 * the target org gets access to the business (and that org's owner gets owner rights,
 * funds included), so an admin moving a business into their own org would hand it
 * to themselves.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveSessionCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeBusiness(supabase, caller.merchantId, id, 'business.update');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const { data: business } = await supabase
    .from('businesses')
    .select('merchant_id')
    .eq('id', id)
    .maybeSingle();
  if (business?.merchant_id !== caller.merchantId) {
    return NextResponse.json(
      { success: false, error: 'Only the business owner can move it between organizations' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const organizationId: string | null =
    body?.organization_id === null || body?.organization_id === undefined
      ? null
      : String(body.organization_id);

  if (organizationId) {
    const orgAuth = await authorizeOrg(supabase, caller.merchantId, organizationId, 'settings.manage');
    if (!orgAuth.ok || orgAuth.role !== 'owner') {
      return NextResponse.json(
        { success: false, error: 'You cannot move a business into that organization' },
        { status: orgAuth.ok ? 403 : orgAuth.status },
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
