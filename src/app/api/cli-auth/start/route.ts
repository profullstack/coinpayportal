import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';

// Headless CLI login — step 1. `coinpay login` POSTs here (unauthenticated) to
// create a pending request, and gets back a URL + short user code to show the
// user, plus a device_code secret it polls with. See /api/cli-auth/poll.

const EXPIRES_IN = 600; // seconds (10 min)
const INTERVAL = 5; // seconds between polls
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

function makeUserCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

export async function POST(request: NextRequest) {
  try {
    let body: { client_name?: string } = {};
    try { body = await request.json(); } catch { /* empty body ok */ }
    const clientName = typeof body?.client_name === 'string' ? body.client_name.slice(0, 100) : null;

    const supabase = serviceClient();
    if (!supabase) return NextResponse.json({ error: 'server_error' }, { status: 500 });

    // Unauthenticated by design — `coinpay login` has no credential yet — so
    // this is the only thing standing between one caller and unlimited pending
    // device codes. Each call burns an 8-character user code from a 32-symbol
    // alphabet; flooding the table both fills it and raises the odds of a
    // collision against a code a real user is about to be shown.
    const rate = await checkRateLimitAsync(getClientIp(request), 'cli_auth_start');
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'slow_down', error_description: 'Too many device authorization requests' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, rate.resetAt - Math.floor(Date.now() / 1000))) } }
      );
    }

    const deviceCode = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + EXPIRES_IN * 1000).toISOString();

    let created = false;
    let userCode = makeUserCode();
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const { error } = await supabase
        .from('cli_device_codes')
        .insert({ device_code: deviceCode, user_code: userCode, client_name: clientName, expires_at: expiresAt })
        .select('id')
        .single();
      if (!error) created = true;
      else userCode = makeUserCode();
    }
    if (!created) return NextResponse.json({ error: 'Failed to start device authorization' }, { status: 500 });

    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://coinpayportal.com';
    const verificationUri = `${base}/cli-auth`;
    return NextResponse.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
      expires_in: EXPIRES_IN,
      interval: INTERVAL,
    });
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
