import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller } from '@/lib/team/api';
import { getAccessibleBusinessRoles } from '@/lib/auth/authz';
import type { Role } from '@/lib/auth/permissions';

/**
 * GET /api/me/access
 * The caller's effective role per accessible business (and the orgs they belong to),
 * so the UI can hide/disable write actions. The API remains the source of truth.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const roleMap = await getAccessibleBusinessRoles(supabase, caller.merchantId);
  const businesses = [...roleMap.entries()].map(([businessId, role]) => ({ businessId, role }));

  const { data: orgMemberships } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('merchant_id', caller.merchantId);
  const organizations = (orgMemberships ?? []).map((o: any) => ({
    organizationId: o.organization_id,
    role: o.role as Role,
  }));

  return NextResponse.json({ success: true, businesses, organizations });
}
