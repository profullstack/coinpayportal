/**
 * WebAuthn Authentication Options
 * POST — returns options for navigator.credentials.get()
 * Public endpoint (no auth required)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getRpId } from '@/lib/webauthn/config';
import { storeChallenge } from '@/lib/webauthn/challenges';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // email is optional, empty body is fine
  }

  const { email } = body;
  const supabase = getSupabase();
  const rpID = getRpId(request);

  let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] = [];
  let userId: string | null = null;

  if (email) {
    // Find user by email
    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('email', email)
      .single();

    if (merchant) {
      userId = merchant.id;
      const { data: creds } = await supabase
        .from('webauthn_credentials')
        .select('credential_id, transports')
        .eq('user_id', merchant.id);

      allowCredentials = (creds || []).map((c) => ({
        id: c.credential_id,
        transports: (c.transports || []) as AuthenticatorTransport[],
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  });

  // Store challenge — use a session key based on email or a special "anonymous" key
  const challengeKey = userId || `anon_${options.challenge.slice(0, 16)}`;
  storeChallenge(challengeKey, options.challenge);

  return NextResponse.json({
    success: true,
    options,
    _challengeKey: challengeKey, // Client needs to send this back for verification
  });
}
