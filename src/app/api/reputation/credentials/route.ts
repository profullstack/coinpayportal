import { NextRequest, NextResponse } from 'next/server';
import { isValidDid } from '@/lib/reputation/crypto';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const did = request.nextUrl.searchParams.get('did');

    if (!did || !isValidDid(did)) {
      return NextResponse.json({ success: false, error: 'Valid DID parameter required' }, { status: 400 });
    }

    // B-04: this filtered on `subject_did` and ordered by `created_at`, and
    // `reputation_credentials` has neither column — it keys the subject as
    // `agent_did` and timestamps issuance as `issued_at`. PostgREST rejects an
    // unknown column, so this route returned 500 for every DID ever asked
    // about, including legitimate ones. Verified against the live schema.
    //
    // `subject_did` is a real column, but on `mutual_attestations`, which is
    // presumably where it was copied from.
    const { data: credentials, error } = await supabase
      .from('reputation_credentials')
      .select('*')
      .eq('agent_did', did)
      .order('issued_at', { ascending: false });

    if (error) {
      console.error('Credentials fetch error:', error);
      return NextResponse.json({ success: false, error: 'Failed to fetch credentials' }, { status: 500 });
    }

    return NextResponse.json({ success: true, credentials: credentials || [] });
  } catch (error) {
    console.error('Credentials fetch error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
