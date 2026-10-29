/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628), step 1.
 * POST /api/oauth/device_authorization  client_id=…&scope=…
 *
 * Returns device_code (the polling secret, stored only as a hash), user_code,
 * verification_uri, expires_in and interval. The user opens
 * verification_uri signed in to CoinPay, types the user_code and approves the
 * named app and scopes; the device polls /api/oauth/token with
 * grant_type=urn:ietf:params:oauth:grant-type:device_code.
 *
 * verification_uri_complete is deliberately NOT returned (as with the legacy
 * /api/cli-auth flow, G-1.2-10): a link that pre-fills the code turns a
 * phishing message into a one-click account grant. The user types the code
 * their own device printed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { hashToken } from '@/lib/crypto/token-hash';
import { clientGrantTypes, GRANT_DEVICE_CODE } from '@/lib/oauth/client';
import { applyBasicAuth, authenticateTokenClient, parseFormOrJson } from '@/lib/oauth/client-auth';
import { DEVICE_CODE_TTL_SECONDS, DEVICE_POLL_INTERVAL_SECONDS, makeUserCode, verificationUri } from '@/lib/oauth/device';
import { validateScopes } from '@/lib/oauth/scopes';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function err(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimitAsync(getClientIp(request), 'oauth_device_start');
  if (!rate.allowed) return err('slow_down', 'Too many device authorization requests', 429);

  const body = applyBasicAuth(request, await parseFormOrJson(request));
  const auth = await authenticateTokenClient(body);
  if (!auth.ok) return err(auth.error, auth.description, auth.status);
  const client = auth.client;
  if (!clientGrantTypes(client).includes(GRANT_DEVICE_CODE)) {
    return err('unauthorized_client', 'This client is not registered for the device_code grant');
  }

  const scopes = validateScopes(body.scope || 'openid', client.scopes);
  if (scopes.length === 0) return err('invalid_scope', 'No valid scopes requested for this client');

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const deviceCode = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000).toISOString();

  let userCode = '';
  for (let attempt = 0; attempt < 4 && !userCode; attempt++) {
    const candidate = makeUserCode();
    const { error } = await supabase.from('oauth_device_codes').insert({
      device_code: hashToken(deviceCode),
      user_code: candidate,
      client_id: client.client_id,
      scopes,
      interval_seconds: DEVICE_POLL_INTERVAL_SECONDS,
      expires_at: expiresAt,
    });
    if (!error) userCode = candidate;
  }
  if (!userCode) return err('server_error', 'Could not start device authorization', 500);

  return NextResponse.json(
    {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri(),
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: DEVICE_POLL_INTERVAL_SECONDS,
    },
    { headers: NO_STORE }
  );
}
