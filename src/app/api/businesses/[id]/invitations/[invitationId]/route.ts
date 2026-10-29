import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveSessionCaller, errorResponse } from '@/lib/team/api';
import { authorizeBusiness } from '@/lib/auth/authz';
import { revokeInvitation, approveInvitation } from '@/lib/team/service';

/** DELETE /api/businesses/[id]/invitations/[invitationId] — revoke or reject (team.manage). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  const { id, invitationId } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveSessionCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeBusiness(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const result = await revokeInvitation({ supabase, scope: 'business', scopeId: id, invitationId });
  if (!result.success) return errorResponse(result);
  return NextResponse.json({ success: true });
}

/**
 * POST /api/businesses/[id]/invitations/[invitationId]  { action: 'approve' }
 * Let someone who accepted an invitation onto the team. Owner only (enforced in
 * approveInvitation); reject is DELETE.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  const { id, invitationId } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveSessionCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeBusiness(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  if (body?.action !== 'approve') {
    return NextResponse.json({ success: false, error: "action must be 'approve'" }, { status: 400 });
  }

  const result = await approveInvitation({
    supabase,
    scope: 'business',
    scopeId: id,
    invitationId,
    actorRole: auth.role,
    approvedByMerchantId: caller.merchantId,
  });
  if (!result.success) return errorResponse(result);
  return NextResponse.json({ success: true, role: result.role });
}
