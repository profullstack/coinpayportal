import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller, errorResponse } from '@/lib/team/api';
import { authorizeOrg } from '@/lib/auth/authz';
import { revokeInvitation } from '@/lib/team/service';

/** DELETE /api/organizations/[id]/invitations/[invitationId] — revoke (team.manage). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  const { id, invitationId } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeOrg(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const result = await revokeInvitation({ supabase, scope: 'org', scopeId: id, invitationId });
  if (!result.success) return errorResponse(result);
  return NextResponse.json({ success: true });
}
