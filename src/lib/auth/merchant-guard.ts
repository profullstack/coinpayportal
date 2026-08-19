import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './jwt';
import { extractBearerToken } from './middleware';
import { getSupabaseAdmin } from '../supabase/server';

export type AuthenticatedMerchant = {
  id: string;
  email: string;
};

/**
 * Verify the request comes from a signed-in merchant, and return which one.
 *
 * The sibling of `requireAdmin` in ./admin-guard, minus the `is_admin` check —
 * for routes every merchant may reach, but only for their own data. It returns
 * the merchant id precisely so callers are forced to scope by it; a route that
 * takes this guard and then queries unscoped is visibly wrong at the call site.
 *
 * Accepts the JWT from either `Authorization: Bearer ...` or the `token`
 * cookie, matching the login flow and `requireAdmin`.
 *
 * Deliberately does not accept API keys. `authenticateRequest` does, and those
 * keys are issued to businesses for payment operations; none of them should
 * carry an implicit grant over the owner's linked bank accounts.
 */
export async function requireMerchant(
  req: NextRequest,
): Promise<AuthenticatedMerchant | NextResponse> {
  const headerToken = extractBearerToken(req.headers.get('authorization'));
  const cookieToken = req.cookies.get('token')?.value ?? null;
  const token = headerToken || cookieToken;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let merchantId: string;
  let email: string;
  try {
    const decoded = verifyToken(token, secret);
    merchantId = decoded.userId;
    email = decoded.email;
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!merchantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Confirm the merchant still exists. A valid signature on a deleted account
  // must not keep working until the token expires.
  const supabase = getSupabaseAdmin();
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, email')
    .eq('id', merchantId)
    .single();

  if (error || !merchant) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return { id: merchant.id, email: merchant.email ?? email };
}
