import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth/jwt';
import { listAccessibleBusinessIds } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getEventLog } from '@/lib/stats/event-log';

/**
 * GET /api/dashboard/logs — the merchant's own risk events.
 *
 * Same log as `/api/admin/logs`, scoped to the businesses this user can
 * access. The scope is resolved server-side from the token: a `business_id`
 * query param may only narrow that set, never widen it. Buyer IP addresses
 * are withheld — they are the platform's risk signal, not the merchant's data.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cookieToken = request.cookies.get('token')?.value ?? null;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : cookieToken;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  let payload;
  try {
    payload = verifyToken(token, jwtSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const parsedLimit = Number.parseInt(params.get('limit') ?? '', 10);

  try {
    const supabase = getSupabaseAdmin();
    const accessible = await listAccessibleBusinessIds(supabase, payload.userId);

    // An explicit ?business_id= may only intersect with what the token allows.
    const requested = params.get('business_id');
    const businessIds = requested
      ? accessible.filter((id) => id === requested)
      : accessible;

    const log = await getEventLog({
      businessIds,
      kind: params.get('kind'),
      decision: params.get('decision'),
      search: params.get('search'),
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      includeIp: false,
    });
    return NextResponse.json(log, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[dashboard/logs] failed', error);
    return NextResponse.json({ error: 'Failed to load event log' }, { status: 500 });
  }
}
