import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller, appBaseUrl, errorResponse } from '@/lib/team/api';
import { authorizeOrg, resolveOrgRole } from '@/lib/auth/authz';
import { listMembers, listInvitations, inviteMember } from '@/lib/team/service';
import { isRole } from '@/lib/auth/permissions';

/** GET /api/organizations/[id]/members — members + pending invites (any member). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const role = await resolveOrgRole(supabase, caller.merchantId, id);
  if (!role) return NextResponse.json({ success: false, error: 'Organization not found' }, { status: 404 });

  const [members, invitations] = await Promise.all([
    listMembers(supabase, 'org', id),
    listInvitations(supabase, 'org', id),
  ]);

  return NextResponse.json({ success: true, role, members, invitations });
}

/** POST /api/organizations/[id]/members — invite a member (team.manage = admin+). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const auth = await authorizeOrg(supabase, caller.merchantId, id, 'team.manage');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email : '';
  const role = body?.role;
  if (!email || !isRole(role)) {
    return NextResponse.json({ success: false, error: 'email and role are required' }, { status: 400 });
  }

  const { data: org } = await supabase.from('organizations').select('name').eq('id', id).maybeSingle();

  const result = await inviteMember({
    supabase,
    scope: 'org',
    scopeId: id,
    scopeName: org?.name ?? 'an organization',
    email,
    role,
    invitedByMerchantId: caller.merchantId,
    actorRole: auth.role,
    baseUrl: appBaseUrl(request),
  });
  if (!result.success) return errorResponse(result);

  return NextResponse.json({ success: true, invitation: { id: result.invitation.id, email: result.invitation.email, role: result.invitation.role } });
}
