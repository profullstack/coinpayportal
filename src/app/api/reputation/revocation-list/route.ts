/**
 * GET /api/reputation/revocation-list — All revoked credential IDs
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('reputation_revocations')
      .select('credential_id, reason, revoked_at')
      .order('revoked_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      revoked: (data || []).map(r => r.credential_id),
      details: data || [],
    });
  } catch (error) {
    console.error('Revocation list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
