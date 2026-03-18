/**
 * WebAuthn Registration Verification
 * POST — verifies credential and stores it
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getAuthUser } from '@/lib/oauth/auth';
import { getRpId, getOrigin } from '@/lib/webauthn/config';
import { consumeChallenge } from '@/lib/webauthn/challenges';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { credential, name } = body;
  if (!credential) {
    return NextResponse.json(
      { success: false, error: 'Missing credential' },
      { status: 400 }
    );
  }

  // Retrieve stored challenge
  const expectedChallenge = consumeChallenge(user.id);
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
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json(
      { success: false, error: 'Registration verification failed' },
      { status: 400 }
    );
  }

  const { credential: registeredCred, credentialDeviceType } = verification.registrationInfo;

  const supabase = getSupabase();

  const { data: saved, error } = await supabase
    .from('webauthn_credentials')
    .insert({
      user_id: user.id,
      credential_id: registeredCred.id,
      public_key: isoBase64URL.fromBuffer(registeredCred.publicKey),
      counter: registeredCred.counter,
      device_type: credentialDeviceType === 'multiDevice' ? 'platform' : 'cross-platform',
      transports: credential.response?.transports || [],
      name: name || 'My Passkey',
    })
    .select('id, name, device_type, created_at')
    .single();

  if (error) {
    console.error('[WebAuthn] Failed to store credential:', error.message, error.code, error.details);
    return NextResponse.json(
      { success: false, error: 'Failed to store credential' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    credential: saved,
  });
}
