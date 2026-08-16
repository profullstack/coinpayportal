import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

export async function GET() {
  const supabase = getSupabase();
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
