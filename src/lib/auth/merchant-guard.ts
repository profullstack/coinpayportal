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

/**
 * `requireMerchant` for routes that change something.
 *
 * The guard above accepts the `token` cookie, which a browser attaches to
 * any request bound for this origin — including one a hostile page makes.
 * A bearer header cannot be forged that way, so it passes as-is. A cookie
 * session is accepted only when the browser says the request came from this
 * site: an `Origin` (or `Referer`) on the same host, or a `Sec-Fetch-Site`
 * of `same-origin`/`none`. A request carrying neither is refused; every
 * modern browser sends at least one of them.
 */
export async function requireMerchantForWrite(
  req: NextRequest,
): Promise<AuthenticatedMerchant | NextResponse> {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const usedBearer = Boolean(extractBearerToken(req.headers.get('authorization')));
  if (usedBearer) return guard;

  const expectedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin' || fetchSite === 'none') return guard;

  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  if (origin && expectedHost) {
    try {
      if (new URL(origin).host.toLowerCase() === expectedHost) return guard;
    } catch {
      // fall through to refusal
    }
  }
  return NextResponse.json(
    { error: 'Cross-site request refused', code: 'cross_site_request' },
    { status: 403 },
  );
}
