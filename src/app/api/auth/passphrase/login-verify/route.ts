/**
 * POST /api/auth/passphrase/login-verify  { challengeKey, signature }
 * Verifies the Ed25519 signature the browser made with the passphrase-derived
 * key and issues the same session as a password login. Public; shares the
 * password login's IP and per-email rate limits so the two paths cannot be
 * used to double an attacker's guess budget.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { generateToken } from '@/lib/auth/jwt';
import { verifyLogin } from '@/lib/passphrase';
import { consumeChallenge } from '@/lib/passphrase/server';

const schema = z.object({
  challengeKey: z.string().min(16).max(128),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
});

const FAIL = 'Wrong email or passphrase';

export async function POST(request: NextRequest) {
  const ipRate = await checkRateLimitAsync(getClientIp(request) || 'unknown', 'merchant_login');
  if (!ipRate.allowed) {
    return NextResponse.json({ success: false, error: 'Too many login attempts. Please try again later.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Missing challengeKey or signature' }, { status: 400 });
  }

  const pending = consumeChallenge(parsed.data.challengeKey);
  if (!pending) {
    return NextResponse.json({ success: false, error: 'Sign-in expired. Please try again.' }, { status: 400 });
  }

  const emailRate = await checkRateLimitAsync(`email:${pending.email}`, 'merchant_login_email');
  if (!emailRate.allowed) {
    return NextResponse.json({ success: false, error: 'Too many login attempts for this account. Please try again later.' }, { status: 429 });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email, name, is_admin')
    .eq('email', pending.email)
    .maybeSingle();
  const { data: cred } = merchant
    ? await supabase.from('passphrase_credentials').select('id, public_key').eq('merchant_id', merchant.id).maybeSingle()
    : { data: null };

  const ok = !!cred && (await verifyLogin(cred.public_key, parsed.data.signature, pending.challenge, pending.email));
  if (!ok || !merchant || !cred) {
    return NextResponse.json({ success: false, error: FAIL }, { status: 401 });
  }

  await supabase.from('passphrase_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', cred.id);

  const token = generateToken({ userId: merchant.id, email: merchant.email }, jwtSecret, '7d');
  const response = NextResponse.json({
    success: true,
    token,
    merchant: { id: merchant.id, email: merchant.email, name: merchant.name, is_admin: merchant.is_admin },
  });
  response.cookies.set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return response;
}
