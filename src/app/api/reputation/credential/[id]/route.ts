import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key'
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  try {
    const { id } = await params;

    const { data: credential, error } = await supabase
      .from('reputation_credentials')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !credential) {
      return NextResponse.json({ success: false, error: 'Credential not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, credential });
  } catch (error) {
    console.error('Credential fetch error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
