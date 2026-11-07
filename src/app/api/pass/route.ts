/**
 * GET /api/pass — the signed-in user's Profullstack Pass status.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSessionUser } from '@/lib/oauth/session-user';
import { getPassStatus, PASS_DAYS, PASS_THRESHOLD_USD } from '@/lib/pass/service';

const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  const offer = { threshold_usd: PASS_THRESHOLD_USD, days: PASS_DAYS };
  if (!user) return NextResponse.json({ signed_in: false, offer }, { headers });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const pass = await getPassStatus(supabase, user.id);
  return NextResponse.json({ signed_in: true, offer, pass }, { headers });
}
