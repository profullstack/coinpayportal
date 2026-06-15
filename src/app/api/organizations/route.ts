import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller } from '@/lib/team/api';
import type { Role } from '@/lib/auth/permissions';

/**
 * GET /api/organizations
 * List organizations the caller belongs to, with their effective role.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const { data: memberships } = await supabase
    .from('organization_members')
    .select('role, organizations(id, name, owner_merchant_id, created_at)')
    .eq('merchant_id', caller.merchantId);

  const organizations = (memberships ?? [])
    .filter((m: any) => m.organizations)
    .map((m: any) => ({
      id: m.organizations.id,
      name: m.organizations.name,
      role: m.role as Role,
      isOwner: m.organizations.owner_merchant_id === caller.merchantId,
      createdAt: m.organizations.created_at,
    }));

  return NextResponse.json({ success: true, organizations });
}

/**
 * POST /api/organizations  { name }
 * Create a new organization owned by the caller (caller becomes its owner member).
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
  }

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ owner_merchant_id: caller.merchantId, name })
    .select('id, name, created_at')
    .single();
  if (error || !org) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Failed to create organization' }, { status: 500 });
  }

  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({ organization_id: org.id, merchant_id: caller.merchantId, role: 'owner' });
  if (memberError) {
    // Roll back the org so we don't leave an ownerless organization behind.
    await supabase.from('organizations').delete().eq('id', org.id);
    return NextResponse.json({ success: false, error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    organization: { id: org.id, name: org.name, role: 'owner', isOwner: true, createdAt: org.created_at },
  });
}
