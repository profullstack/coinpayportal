import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const { data: revocations, error } = await supabase
      .from('reputation_revocations')
      .select('credential_id, reason, revoked_by, revoked_at')
      .order('revoked_at', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      revoked_credentials: (revocations || []).map((r: Record<string, unknown>) => r.credential_id),
      revocations: revocations || [],
    });
  } catch (error) {
    console.error('Revocation list error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
