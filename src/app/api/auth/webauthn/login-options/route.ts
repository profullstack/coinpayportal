/**
 * WebAuthn Authentication Options
 * POST — returns options for navigator.credentials.get()
 * Public endpoint (no auth required)
 */
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { randomBytes } from 'crypto';
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
  // No rate limit on any WebAuthn route. This one answers differently for a
  // registered and an unregistered email, so unlimited it is a free
  // user-enumeration oracle against the whole merchant base.
  const rate = await checkRateLimitAsync(getClientIp(request) || 'unknown', 'webauthn_options');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again shortly.' },
      { status: 429 }
    );
  }

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

  if (email) {
    // Find user by email
    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('email', email)
      .single();

    if (merchant) {
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

  // NEW-07: the key used to be the merchant's own id whenever the email
  // resolved. The store holds one challenge per key, and this route is public,
  // so anyone who knew a merchant's email could overwrite that merchant's
  // pending challenge at will: the victim's authenticator signs the challenge
  // it was handed, login-verify consumes whatever the attacker wrote last, the
  // two never match, and the account cannot be logged into for as long as the
  // attacker keeps posting. It also broke two honest logins from two devices.
  //
  // The key is only a lookup handle — the client echoes it back, and
  // login-verify derives the user from the stored credential, never from this
  // value — so it does not need to identify anyone. Making it unguessable and
  // unique per request removes the shared slot the attack depended on.
  const challengeKey = randomBytes(32).toString('base64url');
  storeChallenge(challengeKey, options.challenge);

  return NextResponse.json({
    success: true,
    options,
    _challengeKey: challengeKey, // Client needs to send this back for verification
  });
}
