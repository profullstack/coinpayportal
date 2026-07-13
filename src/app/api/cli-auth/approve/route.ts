import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

// Headless CLI login — step 2 (the browser side). GET returns the pending
// request's details for display; POST approves or denies it. Both require a
// signed-in merchant session (the `token`/`session` cookie or a Bearer JWT) —
// that merchant is who the CLI is authorized as.

function sessionUser(request: NextRequest): { id: string; email?: string } | null {
  const authHeader = request.headers.get('authorization');
  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) token = authHeader.substring(7);
  if (!token) token = request.cookies.get('token')?.value || request.cookies.get('session')?.value;
  if (!token) return null;
  try {
    const decoded = verifyToken(token, getJwtSecret());
    if (decoded?.userId) return { id: decoded.userId, email: decoded.email };
  } catch { /* not authenticated */ }
  return null;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

const normalize = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

export async function GET(request: NextRequest) {
  const user = sessionUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const code = normalize(request.nextUrl.searchParams.get('code') || '');
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });

  const supabase = serviceClient();
  if (!supabase) return NextResponse.json({ error: 'server_error' }, { status: 500 });

  const { data: row } = await supabase
    .from('cli_device_codes')
    .select('status, client_name, expires_at')
    .eq('user_code', code)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const expired = new Date(row.expires_at).getTime() < Date.now();
  return NextResponse.json({ status: expired ? 'expired' : row.status, client_name: row.client_name });
}

export async function POST(request: NextRequest) {
  const user = sessionUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { user_code?: string; action?: string } = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const code = normalize(body?.user_code || '');
  const action = body?.action === 'deny' ? 'deny' : 'approve';
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });

  const supabase = serviceClient();
  if (!supabase) return NextResponse.json({ error: 'server_error' }, { status: 500 });

  const { data: row } = await supabase
    .from('cli_device_codes')
    .select('id, status, expires_at')
    .eq('user_code', code)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Unknown code' }, { status: 404 });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This request has expired.' }, { status: 400 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'This request has already been handled.' }, { status: 409 });
  }

  const { data: updated } = await supabase
    .from('cli_device_codes')
    .update({
      status: action === 'deny' ? 'denied' : 'approved',
      user_id: action === 'deny' ? null : user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (!updated) return NextResponse.json({ error: 'This request has already been handled.' }, { status: 409 });
  return NextResponse.json({ ok: true, action });
}
