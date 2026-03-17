/**
 * WebAuthn Registration Options
 * GET — returns options for navigator.credentials.create()
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getAuthUser } from '@/lib/oauth/auth';
import { getRpId, getRpName } from '@/lib/webauthn/config';
import { storeChallenge } from '@/lib/webauthn/challenges';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const supabase = getSupabase();

  // Get user email from merchants table
  const { data: merchant } = await supabase
    .from('merchants')
    .select('email')
    .eq('id', user.id)
    .single();

  if (!merchant) {
    return NextResponse.json(
      { success: false, error: 'User not found' },
      { status: 404 }
    );
  }

  // Get existing credentials to exclude
  const { data: existingCreds } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', user.id);

  const rpID = getRpId(request);

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID,
    userName: merchant.email,
    userDisplayName: merchant.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: (existingCreds || []).map((cred) => ({
      id: cred.credential_id,
      transports: cred.transports || [],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Store challenge for verification
  storeChallenge(user.id, options.challenge);

  return NextResponse.json({ success: true, options });
}
