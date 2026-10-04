import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller, errorResponse } from '@/lib/team/api';
import { authorizeOrg } from '@/lib/auth/authz';
import { updateMemberRole, removeMember, setMemberFinanceAccess } from '@/lib/team/service';
import { isRole } from '@/lib/auth/permissions';

/**
 * PATCH /api/organizations/[id]/members/[memberId] — change role (team.manage)
 * and/or `financeAccess` (org owner only). Body: `{ role?, financeAccess? }`.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeOrg(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const hasRole = body?.role !== undefined;
  const hasFinance = typeof body?.financeAccess === 'boolean';
  if (!hasRole && !hasFinance) {
    return NextResponse.json({ success: false, error: 'role or financeAccess is required' }, { status: 400 });
  }
  if (hasRole && !isRole(body.role)) {
    return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
  }

  if (hasRole) {
    const result = await updateMemberRole({
      supabase,
      scope: 'org',
      scopeId: id,
      memberId,
      newRole: body.role,
      actorRole: auth.role,
    });
    if (!result.success) return errorResponse(result);
  }
  if (hasFinance) {
    const result = await setMemberFinanceAccess({
      supabase,
      orgId: id,
      memberId,
      financeAccess: body.financeAccess,
      actorRole: auth.role,
    });
    if (!result.success) return errorResponse(result);
  }
  return NextResponse.json({ success: true });
}

/** DELETE /api/organizations/[id]/members/[memberId] — remove member (team.manage). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeOrg(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const result = await removeMember({
    supabase,
    scope: 'org',
    scopeId: id,
    memberId,
    actorRole: auth.role,
  });
  if (!result.success) return errorResponse(result);
  return NextResponse.json({ success: true });
}
