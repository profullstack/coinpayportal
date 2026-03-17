/**
 * WebAuthn Authentication Verification
 * POST — verifies assertion and returns JWT
 * Public endpoint (no auth required)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { getRpId, getOrigin } from '@/lib/webauthn/config';
import { consumeChallenge } from '@/lib/webauthn/challenges';
import { generateToken } from '@/lib/auth/jwt';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { credential, challengeKey } = body;
  if (!credential || !challengeKey) {
    return NextResponse.json(
      { success: false, error: 'Missing credential or challengeKey' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // Look up the credential in the database
  const credentialId = credential.id;
  const { data: storedCred } = await supabase
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', credentialId)
    .single();

  if (!storedCred) {
    return NextResponse.json(
      { success: false, error: 'Credential not found' },
      { status: 401 }
    );
  }

  // Retrieve stored challenge
  const expectedChallenge = consumeChallenge(challengeKey);
  if (!expectedChallenge) {
    return NextResponse.json(
      { success: false, error: 'Challenge expired or not found. Please try again.' },
      { status: 400 }
    );
  }

  const rpID = getRpId(request);
  const origin = getOrigin(request);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: storedCred.credential_id,
        publicKey: isoBase64URL.toBuffer(storedCred.public_key),
        counter: storedCred.counter,
        transports: storedCred.transports || [],
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  if (!verification.verified) {
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 401 }
    );
  }

  // Update counter and last_used_at
  await supabase
    .from('webauthn_credentials')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', storedCred.id);

  // Get merchant info for the JWT
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email, is_admin')
    .eq('id', storedCred.user_id)
    .single();

  if (!merchant) {
    return NextResponse.json(
      { success: false, error: 'User not found' },
      { status: 404 }
    );
  }

  // Generate JWT (same format as regular login)
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error' },
      { status: 500 }
    );
  }

  const token = generateToken(
    { userId: merchant.id, email: merchant.email },
    jwtSecret,
    '24h'
  );

  return NextResponse.json({
    success: true,
    token,
    merchant: {
      id: merchant.id,
      email: merchant.email,
      is_admin: merchant.is_admin,
    },
  });
}
