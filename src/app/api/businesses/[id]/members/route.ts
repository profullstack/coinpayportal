import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller, appBaseUrl, errorResponse } from '@/lib/team/api';
import { authorizeBusiness, resolveBusinessRole } from '@/lib/auth/authz';
import { listMembers, listInvitations, inviteMember } from '@/lib/team/service';
import { isRole } from '@/lib/auth/permissions';

/** GET /api/businesses/[id]/members — members + pending invites (any member). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const role = await resolveBusinessRole(supabase, caller.merchantId, id);
  if (!role) return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });

  const [members, invitations] = await Promise.all([
    listMembers(supabase, 'business', id),
    listInvitations(supabase, 'business', id),
  ]);

  return NextResponse.json({ success: true, role, members, invitations });
}

/** POST /api/businesses/[id]/members — invite a member (team.manage = admin+). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeBusiness(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email : '';
  const role = body?.role;
  if (!email || !isRole(role)) {
    return NextResponse.json({ success: false, error: 'email and role are required' }, { status: 400 });
  }

  const { data: business } = await supabase.from('businesses').select('name').eq('id', id).maybeSingle();

  const result = await inviteMember({
    supabase,
    scope: 'business',
    scopeId: id,
    scopeName: business?.name ?? 'a business',
    email,
    role,
    invitedByMerchantId: caller.merchantId,
    actorRole: auth.role,
    baseUrl: appBaseUrl(request),
  });
  if (!result.success) return errorResponse(result);

  return NextResponse.json({ success: true, invitation: { id: result.invitation.id, email: result.invitation.email, role: result.invitation.role } });
}
