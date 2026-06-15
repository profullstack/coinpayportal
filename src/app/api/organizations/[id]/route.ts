import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller } from '@/lib/team/api';
import { authorizeOrg, resolveOrgRole } from '@/lib/auth/authz';

/** DELETE /api/organizations/[id] — delete an organization (owner only, must be empty). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const role = await resolveOrgRole(supabase, caller.merchantId, id);
  if (!role) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 });
  if (role !== 'owner') {
    return NextResponse.json({ success: false, error: 'Only the owner can delete an organization' }, { status: 403 });
  }

  // Cannot delete your default workspace.
  const { data: merchant } = await supabase
    .from('merchants')
    .select('default_org_id')
    .eq('id', caller.merchantId)
    .maybeSingle();
  if (merchant?.default_org_id === id) {
    return NextResponse.json({ success: false, error: 'Cannot delete your default organization' }, { status: 400 });
  }

  // Must be empty — move or remove its businesses first.
  const { count } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { success: false, error: 'Move its businesses to another organization first' },
      { status: 409 },
    );
  }

  const { error } = await supabase.from('organizations').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/** GET /api/organizations/[id] — org details for any member. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const role = await resolveOrgRole(supabase, caller.merchantId, id);
  if (!role) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 });

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, owner_merchant_id, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!org) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 });

  return NextResponse.json({
    success: true,
    organization: {
      id: org.id,
      name: org.name,
      role,
      isOwner: org.owner_merchant_id === caller.merchantId,
      createdAt: org.created_at,
    },
  });
}

/** PATCH /api/organizations/[id] — rename (settings.manage = admin+). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeOrg(supabase, caller.merchantId, id, 'settings.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });

  const { error } = await supabase.from('organizations').update({ name }).eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
