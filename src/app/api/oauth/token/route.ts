/**
 * OAuth2 Token Endpoint
 * POST — exchange authorization code for tokens, or refresh tokens
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateClient } from '@/lib/oauth/client';
import {
  generateAccessToken,
  generateIdToken,
  generateRefreshToken,
  validatePKCE,
} from '@/lib/oauth/tokens';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function parseBody(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  // Default to JSON
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function tokenError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    }
  );
}

export async function POST(request: NextRequest) {
  const body = await parseBody(request);
  const grantType = body.grant_type;

  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(body);
  }

  if (grantType === 'refresh_token') {
    return handleRefreshToken(body);
  }

  return tokenError('unsupported_grant_type', 'Unsupported grant_type');
}

async function handleAuthorizationCode(body: Record<string, string>) {
  const { code, redirect_uri, client_id, client_secret, code_verifier } = body;

  if (!code || !redirect_uri || !client_id) {
    return tokenError('invalid_request', 'Missing required parameters: code, redirect_uri, client_id');
  }

  // Authenticate client (client_secret required for confidential clients)
  if (client_secret) {
    const authResult = await authenticateClient(client_id, client_secret);
    if (!authResult.valid) {
      return tokenError('invalid_client', authResult.error || 'Invalid client credentials', 401);
    }
  }

  const supabase = getSupabase();

  // Look up the authorization code
  const { data: authCode, error } = await supabase
    .from('oauth_authorization_codes')
    .select('*')
    .eq('code', code)
    .single();

  if (error || !authCode) {
    return tokenError('invalid_grant', 'Invalid authorization code');
  }

  // Check if code is expired
  if (new Date(authCode.expires_at) < new Date()) {
    return tokenError('invalid_grant', 'Authorization code has expired');
  }

  // Check if code was already used
  if (authCode.used_at) {
    return tokenError('invalid_grant', 'Authorization code has already been used');
  }

  // Verify client_id matches
  if (authCode.client_id !== client_id) {
    return tokenError('invalid_grant', 'Client ID mismatch');
  }

  // Verify redirect_uri matches
  if (authCode.redirect_uri !== redirect_uri) {
    return tokenError('invalid_grant', 'Redirect URI mismatch');
  }

  // PKCE validation
  if (authCode.code_challenge) {
    if (!code_verifier) {
      return tokenError('invalid_grant', 'code_verifier is required');
    }
    const pkceValid = validatePKCE(
      code_verifier,
      authCode.code_challenge,
      authCode.code_challenge_method || 'S256'
    );
    if (!pkceValid) {
      return tokenError('invalid_grant', 'PKCE validation failed');
    }
  }

  // Mark code as used
  await supabase
    .from('oauth_authorization_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', authCode.id);

  // Get user info for token claims
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email, name')
    .eq('id', authCode.user_id)
    .single();

  const user = merchant || { id: authCode.user_id, email: undefined, name: undefined };

  const client = { client_id };
  const scopes = authCode.scopes || ['openid'];

  // Generate tokens
  const accessToken = generateAccessToken(user, client, scopes);
  const idToken = scopes.includes('openid')
    ? generateIdToken(user, client, scopes, authCode.nonce)
    : undefined;

  const refreshTokenValue = generateRefreshToken();

  // Store refresh token
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('oauth_refresh_tokens').insert({
    token: refreshTokenValue,
    client_id,
    user_id: authCode.user_id,
    scopes,
    expires_at: refreshExpiresAt,
  });

  const response: Record<string, any> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: refreshTokenValue,
    scope: scopes.join(' '),
  };

  if (idToken) {
    response.id_token = idToken;
  }

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

async function handleRefreshToken(body: Record<string, string>) {
  const { refresh_token, client_id, client_secret } = body;

  if (!refresh_token || !client_id) {
    return tokenError('invalid_request', 'Missing required parameters: refresh_token, client_id');
  }

  // Authenticate client
  if (client_secret) {
    const authResult = await authenticateClient(client_id, client_secret);
    if (!authResult.valid) {
      return tokenError('invalid_client', authResult.error || 'Invalid client credentials', 401);
    }
  }

  const supabase = getSupabase();

  // Look up refresh token
  const { data: storedToken, error } = await supabase
    .from('oauth_refresh_tokens')
    .select('*')
    .eq('token', refresh_token)
    .eq('client_id', client_id)
    .single();

  if (error || !storedToken) {
    return tokenError('invalid_grant', 'Invalid refresh token');
  }

  if (storedToken.revoked_at) {
    return tokenError('invalid_grant', 'Refresh token has been revoked');
  }

  if (new Date(storedToken.expires_at) < new Date()) {
    return tokenError('invalid_grant', 'Refresh token has expired');
  }

  // Revoke old refresh token
  await supabase
    .from('oauth_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', storedToken.id);

  // Get user info
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email, name')
    .eq('id', storedToken.user_id)
    .single();

  const user = merchant || { id: storedToken.user_id };
  const client = { client_id };
  const scopes = storedToken.scopes || ['openid'];

  // Generate new tokens
  const accessToken = generateAccessToken(user, client, scopes);
  const newRefreshToken = generateRefreshToken();

  // Store new refresh token
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('oauth_refresh_tokens').insert({
    token: newRefreshToken,
    client_id,
    user_id: storedToken.user_id,
    scopes,
    expires_at: refreshExpiresAt,
  });

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: scopes.join(' '),
    },
    {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    }
  );
}
