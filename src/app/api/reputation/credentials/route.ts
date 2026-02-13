import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidDid } from '@/lib/reputation/crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const did = request.nextUrl.searchParams.get('did');

    if (!did || !isValidDid(did)) {
      return NextResponse.json({ success: false, error: 'Valid DID parameter required' }, { status: 400 });
    }

    const { data: credentials, error } = await supabase
      .from('reputation_credentials')
      .select('*')
      .eq('subject_did', did)
      .order('created_at', { ascending: false });

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
