/**
 * POST /api/reputation/verify — Verify a credential
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCredentialSignature } from '@/lib/reputation/crypto';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    const { credential_id } = await request.json();

    if (!credential_id) {
      return NextResponse.json({ error: 'Missing credential_id' }, { status: 400 });
    }

    const supabase = getSupabase();

    const { data: credential, error } = await supabase
      .from('reputation_credentials')
      .select('*')
      .eq('id', credential_id)
      .single();

    if (error || !credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    }

    // Check revocation
    if (credential.revoked) {
      return NextResponse.json({
        valid: false,
        reason: 'revoked',
        revoked_at: credential.revoked_at,
      });
    }

    // Check timestamp validity (credentials older than 1 year are expired)
    const issuedAt = new Date(credential.issued_at);
    const oneYearAgo = new Date(Date.now() - 365 * 86400000);
    if (issuedAt < oneYearAgo) {
      return NextResponse.json({
        valid: false,
        reason: 'expired',
        issued_at: credential.issued_at,
      });
    }

    // Verify signature
    const { signature, ...credData } = credential;
    const sigValid = verifyCredentialSignature(credData, signature);

    return NextResponse.json({
      valid: sigValid,
      reason: sigValid ? 'valid' : 'invalid_signature',
      credential,
    });
  } catch (error) {
    console.error('Credential verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
