/**
 * OAuth 2.1 Token Endpoint
 * POST — authorization_code (PKCE), refresh_token (rotation + reuse detection),
 *        urn:ietf:params:oauth:grant-type:device_code (RFC 8628).
 * No implicit, no password, no client_credentials.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashToken, isPresentableToken } from '@/lib/crypto/token-hash';
import { clientGrantTypes, clientRequiresPkce, GRANT_DEVICE_CODE, isPublicClient } from '@/lib/oauth/client';
import { applyBasicAuth, authenticateTokenClient, parseFormOrJson } from '@/lib/oauth/client-auth';
import { issueTokenSet, revokeFamily, rotateRefreshToken } from '@/lib/oauth/grants';
import { validatePKCE } from '@/lib/oauth/tokens';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function tokenError(error: string, description: string, status = 400) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (status === 401) headers['WWW-Authenticate'] = 'Basic realm="coinpay", error="invalid_client"';
  return NextResponse.json({ error, error_description: description }, { status, headers });
}

function ok(body: Record<string, unknown>) {
  return NextResponse.json(body, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const body = applyBasicAuth(request, await parseFormOrJson(request));
  const grantType = body.grant_type;

  if (grantType === 'authorization_code') return handleAuthorizationCode(body);
  if (grantType === 'refresh_token') return handleRefreshToken(body);
  if (grantType === GRANT_DEVICE_CODE) return handleDeviceCode(body);
  return tokenError('unsupported_grant_type', 'Unsupported grant_type');
}

async function handleAuthorizationCode(body: Record<string, string>) {
  const { code, redirect_uri, client_id, code_verifier } = body;
  if (!code || !redirect_uri || !client_id) {
    return tokenError('invalid_request', 'Missing required parameters: code, redirect_uri, client_id');
  }

  const supabase = getSupabase();
  const { data: authCode, error } = await supabase
    .from('oauth_authorization_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error || !authCode) return tokenError('invalid_grant', 'Invalid authorization code');

  // Authenticate the client. A legacy confidential client may skip its secret
  // only when the code is PKCE-bound (what it always could do).
  const auth = await authenticateTokenClient(body, { allowLegacySecretless: Boolean(authCode.code_challenge) });
  if (!auth.ok) return tokenError(auth.error, auth.description, auth.status);
  const client = auth.client;

  if (authCode.client_id !== client.client_id) return tokenError('invalid_grant', 'Client ID mismatch');

  // Replay of a used code: refuse, and revoke what the first exchange issued.
  if (authCode.used) {
    if (authCode.family_id) await revokeFamily(supabase, authCode.family_id, client.client_id, 'code_reuse');
    return tokenError('invalid_grant', 'Authorization code has already been used');
  }
  if (new Date(authCode.expires_at) < new Date()) return tokenError('invalid_grant', 'Authorization code has expired');
  if (authCode.redirect_uri !== redirect_uri) return tokenError('invalid_grant', 'Redirect URI mismatch');
  if (!clientGrantTypes(client).includes('authorization_code')) {
    return tokenError('unauthorized_client', 'This client may not use the authorization_code grant');
  }

  if (authCode.code_challenge) {
    if (!code_verifier) return tokenError('invalid_grant', 'code_verifier is required');
    // RFC 7636 4.1 shape, enforced for clients registered under OAuth 2.1.
    if (!client.legacy_oauth2 && !/^[A-Za-z0-9\-._~]{43,128}$/.test(code_verifier)) return tokenError('invalid_grant', 'Malformed code_verifier');
    if (!validatePKCE(code_verifier, authCode.code_challenge, authCode.code_challenge_method || 'S256')) {
      return tokenError('invalid_grant', 'PKCE validation failed');
    }
  } else if (clientRequiresPkce(client) || isPublicClient(client)) {
    // The authorize endpoint refuses these; a code minted before the client
    // became PKCE-only must not slip through either.
    return tokenError('invalid_grant', 'This client must use PKCE');
  } else if (code_verifier) {
    return tokenError('invalid_grant', 'code_verifier sent for a code issued without code_challenge');
  }

  // Single use: compare-and-swap on `used`.
  const { data: consumed } = await supabase
    .from('oauth_authorization_codes')
    .update({ used: true })
    .eq('id', authCode.id)
    .eq('used', false)
    .select('id');
  if (!consumed || consumed.length === 0) return tokenError('invalid_grant', 'Authorization code has already been used');

  const scopes: string[] = authCode.scopes || ['openid'];
  try {
    const issued = await issueTokenSet(supabase, {
      userId: authCode.user_id,
      client,
      scopes,
      nonce: authCode.nonce,
    });
    await supabase.from('oauth_authorization_codes').update({ family_id: issued.familyId }).eq('id', authCode.id);
    return ok(issued.body);
  } catch {
    return tokenError('server_error', 'Could not issue tokens', 500);
  }
}

async function handleRefreshToken(body: Record<string, string>) {
  const { refresh_token, client_id } = body;
  if (!refresh_token || !client_id) {
    return tokenError('invalid_request', 'Missing required parameters: refresh_token, client_id');
  }
  // Confidential clients always authenticate on refresh; public clients are
  // identified by the (sender-unconstrained, so rotating) refresh token.
  const auth = await authenticateTokenClient(body);
  if (!auth.ok) return tokenError(auth.error, auth.description, auth.status);
  if (!clientGrantTypes(auth.client).includes('refresh_token')) {
    return tokenError('unauthorized_client', 'This client may not use the refresh_token grant');
  }
  if (!isPresentableToken(refresh_token)) return tokenError('invalid_grant', 'Invalid refresh token');

  const result = await rotateRefreshToken(getSupabase(), { presented: refresh_token, client: auth.client });
  if (!result.ok) return tokenError(result.error, result.description, result.error === 'server_error' ? 500 : 400);
  return ok(result.body);
}

async function handleDeviceCode(body: Record<string, string>) {
  const { device_code } = body;
  if (!device_code || !body.client_id) return tokenError('invalid_request', 'Missing required parameters: device_code, client_id');

  const auth = await authenticateTokenClient(body);
  if (!auth.ok) return tokenError(auth.error, auth.description, auth.status);
  const client = auth.client;
  if (!clientGrantTypes(client).includes(GRANT_DEVICE_CODE)) {
    return tokenError('unauthorized_client', 'This client may not use the device_code grant');
  }

  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('oauth_device_codes')
    .select('*')
    .eq('device_code', hashToken(device_code))
    .maybeSingle();
  if (!row || row.client_id !== client.client_id) return tokenError('invalid_grant', 'Invalid device_code');

  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) return tokenError('expired_token', 'The device code has expired');
  if (row.status === 'denied') return tokenError('access_denied', 'The user denied the request');
  if (row.status === 'completed') return tokenError('invalid_grant', 'The device code has already been used');

  // RFC 8628 3.5: polling faster than the interval earns slow_down and +5s.
  const interval = Number(row.interval_seconds) || 5;
  const last = row.last_polled_at ? new Date(row.last_polled_at).getTime() : 0;
  if (last && now - last < interval * 1000) {
    await supabase
      .from('oauth_device_codes')
      .update({ interval_seconds: Math.min(interval + 5, 60), last_polled_at: new Date(now).toISOString() })
      .eq('id', row.id);
    return tokenError('slow_down', `Poll no more than every ${interval + 5} seconds`);
  }
  await supabase.from('oauth_device_codes').update({ last_polled_at: new Date(now).toISOString() }).eq('id', row.id);

  if (row.status !== 'approved' || !row.user_id) {
    return tokenError('authorization_pending', 'The user has not approved the request yet');
  }

  const { data: claimed } = await supabase
    .from('oauth_device_codes')
    .update({ status: 'completed' })
    .eq('id', row.id)
    .eq('status', 'approved')
    .select('id');
  if (!claimed || claimed.length === 0) return tokenError('invalid_grant', 'The device code has already been used');

  try {
    const issued = await issueTokenSet(supabase, { userId: row.user_id, client, scopes: row.scopes || ['openid'] });
    return ok(issued.body);
  } catch {
    return tokenError('server_error', 'Could not issue tokens', 500);
  }
}
