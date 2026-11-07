/**
 * GET  /api/pass/apps — Profullstack properties that sign in with CoinPay, and
 *                       which ones this user has already approved.
 * POST /api/pass/apps — { hosts: string[] } pre-approve those properties, so
 *                       "Sign in with CoinPay" there skips the consent screen.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSessionUser } from '@/lib/oauth/session-user';
import { connectPassApps, listPassApps } from '@/lib/pass/apps';

const headers = { 'Cache-Control': 'no-store' };

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  const apps = await listPassApps(db(), user?.id ?? null);
  return NextResponse.json({ signed_in: !!user, apps }, { headers });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401, headers });

  let body: { hosts?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers });
  }
  const hosts = Array.isArray(body.hosts) ? body.hosts.filter((h): h is string => typeof h === 'string') : [];
  if (hosts.length === 0 || hosts.length > 500) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'hosts must be a non-empty list' },
      { status: 400, headers },
    );
  }

  try {
    const result = await connectPassApps(db(), user.id, hosts);
    return NextResponse.json(result, { headers });
  } catch (error) {
    console.error('[pass] connect failed', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers });
  }
}
