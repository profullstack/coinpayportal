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
