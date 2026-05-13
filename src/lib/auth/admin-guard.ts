import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from './jwt';
import { extractBearerToken } from './middleware';
import { getSupabaseAdmin } from '../supabase/server';

export type AdminMerchant = {
  id: string;
  email: string;
  is_admin: true;
};

/**
 * Verify the request is from a signed-in admin merchant. Returns either the
 * admin merchant record or a NextResponse to short-circuit the route handler.
 *
 * Accepts the JWT from either the `Authorization: Bearer ...` header or the
 * `token` cookie (matches existing login flow).
 */
export async function requireAdmin(
  req: NextRequest,
): Promise<AdminMerchant | NextResponse> {
  const headerToken = extractBearerToken(req.headers.get('authorization'));
  const cookieToken = req.cookies.get('token')?.value ?? null;
  const token = headerToken || cookieToken;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 },
    );
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

  const supabase = getSupabaseAdmin();
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, email, is_admin')
    .eq('id', merchantId)
    .single();

  if (error || !merchant) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  if (!merchant.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { id: merchant.id, email: merchant.email ?? email, is_admin: true };
}

/**
 * Server-side guard for admin App Router pages. Reads the `token` cookie set
 * by the login flow, verifies it, and confirms the merchant has `is_admin`.
 * Redirects unauthenticated users to /login and non-admins to /dashboard so
 * the page never renders for unauthorized callers.
 */
export async function requireAdminPage(redirectPath = '/admin'): Promise<AdminMerchant> {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value ?? null;

  if (!token) {
    redirect(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    redirect('/dashboard');
  }

  let merchantId: string;
  let email: string;
  try {
    const decoded = verifyToken(token, secret);
    merchantId = decoded.userId;
    email = decoded.email;
  } catch {
    redirect(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  }

  if (!merchantId) {
    redirect(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  }

  const supabase = getSupabaseAdmin();
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, email, is_admin')
    .eq('id', merchantId)
    .single();

  if (error || !merchant || !merchant.is_admin) {
    redirect('/dashboard');
  }

  return { id: merchant.id, email: merchant.email ?? email, is_admin: true };
}
