import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller, errorResponse } from '@/lib/team/api';
import { authorizeBusiness } from '@/lib/auth/authz';
import { updateMemberRole, removeMember } from '@/lib/team/service';
import { isRole } from '@/lib/auth/permissions';

/** PATCH /api/businesses/[id]/members/[memberId] — change role (team.manage). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeBusiness(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  if (!isRole(body?.role)) {
    return NextResponse.json({ success: false, error: 'role is required' }, { status: 400 });
  }

  const result = await updateMemberRole({
    supabase,
    scope: 'business',
    scopeId: id,
    memberId,
    newRole: body.role,
    actorRole: auth.role,
  });
  if (!result.success) return errorResponse(result);
  return NextResponse.json({ success: true });
}

/** DELETE /api/businesses/[id]/members/[memberId] — remove member (team.manage). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeBusiness(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const result = await removeMember({
    supabase,
    scope: 'business',
    scopeId: id,
    memberId,
    actorRole: auth.role,
  });
  if (!result.success) return errorResponse(result);
  return NextResponse.json({ success: true });
}
