import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentialSignature } from '@/lib/reputation/crypto';
import { createServiceClient } from '@/lib/supabase/service-client';

function getSupabase() {
  return createServiceClient();
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
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
