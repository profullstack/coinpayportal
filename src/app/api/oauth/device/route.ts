/**
 * RFC 8628 verification, the browser side. Signed-in CoinPay user only.
 * GET  ?user_code=XXXX-XXXX → the app name, description and scopes to approve
 * POST { user_code, action: 'approve' | 'deny' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSessionUser } from '@/lib/oauth/session-user';
import { normalizeUserCode } from '@/lib/oauth/device';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

const NO_STORE = { 'Cache-Control': 'no-store' };

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function findPending(code: string) {
  const supabase = db();
  const { data: row } = await supabase
    .from('oauth_device_codes')
    .select('id, client_id, scopes, status, expires_at')
    .eq('user_code', code)
    .maybeSingle();
  if (!row) return { supabase, row: null, client: null };
  const { data: client } = await supabase
    .from('oauth_clients')
    .select('client_id, name, description, is_active')
    .eq('client_id', row.client_id)
    .maybeSingle();
  return { supabase, row, client: client && client.is_active ? client : null };
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401, headers: NO_STORE });
  const rate = await checkRateLimitAsync(user.id, 'oauth_device_lookup');
  if (!rate.allowed) return NextResponse.json({ error: 'slow_down' }, { status: 429, headers: NO_STORE });

  const code = normalizeUserCode(request.nextUrl.searchParams.get('user_code') || '');
  if (code.length !== 9) return NextResponse.json({ error: 'invalid_code' }, { status: 400, headers: NO_STORE });
  const { row, client } = await findPending(code);
  if (!row || !client) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  const expired = new Date(row.expires_at).getTime() < Date.now();
  return NextResponse.json(
    {
      status: expired ? 'expired' : row.status,
      client_id: client.client_id,
      name: client.name,
      description: client.description,
      scopes: row.scopes,
      account: user.email ?? null,
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401, headers: NO_STORE });
  const rate = await checkRateLimitAsync(user.id, 'oauth_device_lookup');
  if (!rate.allowed) return NextResponse.json({ error: 'slow_down' }, { status: 429, headers: NO_STORE });

  let body: { user_code?: string; action?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  const code = normalizeUserCode(body.user_code || '');
  const action = body.action === 'approve' ? 'approve' : body.action === 'deny' ? 'deny' : null;
  if (code.length !== 9 || !action) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }

  const { supabase, row, client } = await findPending(code);
  if (!row || !client) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired', error_description: 'This code has expired.' }, { status: 400, headers: NO_STORE });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'already_handled', error_description: 'This code was already used.' }, { status: 409, headers: NO_STORE });
  }

  const { data: updated } = await supabase
    .from('oauth_device_codes')
    .update({
      status: action === 'approve' ? 'approved' : 'denied',
      user_id: action === 'approve' ? user.id : null,
      approved_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id');
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'already_handled' }, { status: 409, headers: NO_STORE });
  }

  if (action === 'approve') {
    // Record consent like the browser flow does, merging with any earlier grant.
    const { data: prior } = await supabase
      .from('oauth_consents')
      .select('scopes')
      .eq('user_id', user.id)
      .eq('client_id', row.client_id)
      .maybeSingle();
    const merged = Array.from(new Set([...(prior?.scopes || []), ...(row.scopes || [])]));
    await supabase
      .from('oauth_consents')
      .upsert({ user_id: user.id, client_id: row.client_id, scopes: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id,client_id' });
  }
  return NextResponse.json({ ok: true, action }, { headers: NO_STORE });
}
