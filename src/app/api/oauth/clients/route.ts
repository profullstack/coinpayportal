/**
 * OAuth2 Client Management
 * GET  — list my clients
 * POST — register a new client
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import {
  checkRedirectUris,
  hashClientSecret,
  SUPPORTED_GRANT_TYPES,
  TOKEN_ENDPOINT_AUTH_METHODS,
  GRANT_DEVICE_CODE,
  type TokenEndpointAuthMethod,
} from '@/lib/oauth/client';
import { VALID_SCOPES } from '@/lib/oauth/scopes';

const CLIENT_COLUMNS =
  'id, client_id, name, description, redirect_uris, scopes, is_active, created_at, updated_at, token_endpoint_auth_method, grant_types, require_pkce, id_token_signed_response_alg, legacy_oauth2';
import { getAuthUser } from '@/lib/oauth/auth';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('oauth_clients')
    .select(`${CLIENT_COLUMNS}, client_secret_encrypted`)
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch clients' },
      { status: 500 }
    );
  }

  // Surface only whether the encrypted secret exists, not the ciphertext —
  // the dedicated /encrypted-secret endpoint returns it on demand.
  const clients = (rows ?? []).map((row) => {
    const { client_secret_encrypted: enc, ...rest } = row as Record<string, unknown>;
    return { ...rest, has_encrypted_secret: !!enc };
  });

  return NextResponse.json({ success: true, clients });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
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

  const { name, description, redirect_uris, scopes } = body;

  if (!name || typeof name !== 'string' || !redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return NextResponse.json(
      { success: false, error: 'name and redirect_uris (non-empty array) are required' },
      { status: 400 }
    );
  }

  // OAuth 2.1 client metadata (RFC 7591 names). "none" registers a PUBLIC
  // client (native app, CLI, PWA): no secret is issued, PKCE S256 is
  // mandatory, and loopback redirects (any port) are allowed for it alone.
  const authMethod: TokenEndpointAuthMethod = body.token_endpoint_auth_method ?? 'client_secret_basic';
  if (!TOKEN_ENDPOINT_AUTH_METHODS.includes(authMethod)) {
    return NextResponse.json(
      { success: false, error: `token_endpoint_auth_method must be one of ${TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}` },
      { status: 400 }
    );
  }
  const isPublic = authMethod === 'none';

  const uriError = checkRedirectUris(redirect_uris, isPublic);
  if (uriError) return NextResponse.json({ success: false, error: uriError }, { status: 400 });

  let grantTypes: string[] = Array.isArray(body.grant_types) && body.grant_types.length
    ? body.grant_types
    : isPublic
      ? ['authorization_code', 'refresh_token', GRANT_DEVICE_CODE]
      : ['authorization_code', 'refresh_token'];
  // 'device_code' is accepted as shorthand for the RFC 8628 URN.
  grantTypes = Array.from(new Set(grantTypes.map((g) => (g === 'device_code' ? GRANT_DEVICE_CODE : g))));
  const badGrant = grantTypes.find((g) => !SUPPORTED_GRANT_TYPES.includes(g));
  if (badGrant) {
    return NextResponse.json(
      { success: false, error: `unsupported grant_type "${badGrant}" (implicit and password are not offered under OAuth 2.1)` },
      { status: 400 }
    );
  }

  const alg = body.id_token_signed_response_alg ?? 'RS256';
  if (alg !== 'RS256' && alg !== 'HS256') {
    return NextResponse.json({ success: false, error: 'id_token_signed_response_alg must be RS256 or HS256' }, { status: 400 });
  }

  let scopeList: string[] = ['openid', 'profile', 'email'];
  if (scopes !== undefined) {
    const list = Array.isArray(scopes) ? scopes : typeof scopes === 'string' ? scopes.split(/\s+/) : null;
    if (!list || list.some((s: unknown) => typeof s !== 'string')) {
      return NextResponse.json({ success: false, error: 'scopes must be an array of strings' }, { status: 400 });
    }
    const unknown = list.filter((s: string) => s && !(VALID_SCOPES as readonly string[]).includes(s));
    if (unknown.length) {
      return NextResponse.json(
        { success: false, error: `unknown scope(s): ${unknown.join(', ')}. Valid: ${VALID_SCOPES.join(' ')}` },
        { status: 400 }
      );
    }
    scopeList = Array.from(new Set(list.filter(Boolean)));
  }

  // Generate client_id and client_secret at application layer
  const clientId = 'cp_' + randomBytes(12).toString('hex');
  const plaintextSecret = isPublic ? null : 'cps_' + randomBytes(24).toString('hex');
  const hashedSecret = plaintextSecret ? await hashClientSecret(plaintextSecret) : '';

  const supabase = getSupabase();
  const { data: client, error } = await supabase
    .from('oauth_clients')
    .insert({
      client_id: clientId,
      client_secret: hashedSecret,
      name,
      description: description || null,
      redirect_uris,
      scopes: scopeList,
      owner_id: user.id,
      token_endpoint_auth_method: authMethod,
      grant_types: grantTypes,
      require_pkce: true,
      id_token_signed_response_alg: alg,
      legacy_oauth2: false,
    })
    .select(CLIENT_COLUMNS)
    .single();

  if (error) {
    console.error('[OAuth] Failed to create client:', error.message, error.code, error.details);
    return NextResponse.json(
      { success: false, error: 'Failed to create client' },
      { status: 500 }
    );
  }

  if (!plaintextSecret) {
    return NextResponse.json(
      {
        success: true,
        client,
        note: 'Public client: no client_secret. Use authorization code + PKCE (S256) or the device flow.',
      },
      { status: 201 }
    );
  }

  // Return the plaintext secret once — it cannot be retrieved again
  return NextResponse.json(
    {
      success: true,
      client: {
        ...client,
        client_secret: plaintextSecret,
      },
      warning: 'Store the client_secret securely. It will not be shown again.',
    },
    { status: 201 }
  );
}
