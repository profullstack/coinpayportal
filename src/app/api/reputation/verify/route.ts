import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCredentialSignature } from '@/lib/reputation/crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credential_id } = body;

    if (!credential_id) {
      return NextResponse.json({ valid: false, reason: 'credential_id required' }, { status: 400 });
    }

    const { data: credential, error } = await supabase
      .from('reputation_credentials')
      .select('*')
      .eq('id', credential_id)
      .single();

    if (error || !credential) {
      return NextResponse.json({ valid: false, reason: 'Credential not found' }, { status: 404 });
    }

    if (credential.revoked) {
      return NextResponse.json({ valid: false, reason: 'Credential has been revoked' });
    }

    const { data: revocation } = await supabase
      .from('reputation_revocations')
      .select('id')
      .eq('credential_id', credential_id)
      .limit(1)
      .single();

    if (revocation) {
      return NextResponse.json({ valid: false, reason: 'Credential found in revocation registry' });
    }

    const sigValid = verifyCredentialSignature({
      agent_did: credential.agent_did,
      credential_type: credential.credential_type,
      category: credential.category,
      data: credential.data,
      window_start: credential.window_start,
      window_end: credential.window_end,
      issued_at: credential.issued_at,
      signature: credential.signature,
    });

    if (!sigValid) {
      return NextResponse.json({ valid: false, reason: 'Invalid signature' });
    }

    return NextResponse.json({ valid: true });
  } catch (error) {
    console.error('Credential verification error:', error);
    return NextResponse.json({ valid: false, reason: 'Internal server error' }, { status: 500 });
  }
}
