import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

// Headless CLI login — step 3. The CLI polls here with its device_code. While
// pending it gets 202 authorization_pending. Once the merchant has approved it in
// the browser, the first successful poll mints a merchant session JWT (identical
// to a password login) and returns it once. See /api/cli-auth/{start,approve}.

export async function POST(request: NextRequest) {
  try {
    let body: { device_code?: string } = {};
    try { body = await request.json(); } catch { /* handled below */ }
    const deviceCode = body?.device_code;
    if (!deviceCode || typeof deviceCode !== 'string') {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: 'server_error' }, { status: 500 });
    const supabase = createClient(url, key);

    const { data: row } = await supabase
      .from('cli_device_codes')
      .select('id, status, user_id, expires_at')
      .eq('device_code', deviceCode)
      .maybeSingle();

    if (!row) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ status: 'expired', error: 'expired_token' }, { status: 400 });
    }
    if (row.status === 'denied') {
      return NextResponse.json({ status: 'denied', error: 'access_denied' }, { status: 400 });
    }
    if (row.status === 'completed') {
      return NextResponse.json({ status: 'expired', error: 'expired_token' }, { status: 400 });
    }
    if (row.status !== 'approved' || !row.user_id) {
      return NextResponse.json({ status: 'pending', error: 'authorization_pending' }, { status: 202 });
    }

    // Atomically claim so concurrent polls can't both mint.
    const { data: claimed } = await supabase
      .from('cli_device_codes')
      .update({ status: 'completed' })
      .eq('id', row.id)
      .eq('status', 'approved')
      .select('id')
      .maybeSingle();
    if (!claimed) {
      return NextResponse.json({ status: 'expired', error: 'expired_token' }, { status: 400 });
    }

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id, email')
      .eq('id', row.user_id)
      .single();
    if (!merchant) return NextResponse.json({ error: 'server_error' }, { status: 500 });

    // Same session token a password login yields (verifySession checks userId).
    const token = generateToken({ userId: merchant.id, email: merchant.email }, getJwtSecret(), '7d');
    return NextResponse.json({ status: 'complete', token });
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
