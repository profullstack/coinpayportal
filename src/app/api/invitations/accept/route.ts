import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { resolveCaller, errorResponse } from '@/lib/team/api';
import { acceptInvitation } from '@/lib/team/service';

/**
 * POST /api/invitations/accept  { token }
 * The caller must be authenticated; their email must match the invited address.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const caller = await resolveCaller(supabase, request);
  if (caller instanceof NextResponse) return caller;

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token) {
    return NextResponse.json({ success: false, error: 'token is required' }, { status: 400 });
  }

  const result = await acceptInvitation({
    supabase,
    token,
    acceptingMerchantId: caller.merchantId,
    acceptingEmail: caller.email,
  });
  if (!result.success) return errorResponse(result);

  return NextResponse.json({ success: true, scope: result.scope, scopeId: result.scopeId, role: result.role });
}
