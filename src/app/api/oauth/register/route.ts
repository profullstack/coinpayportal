/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591), open.
 * POST /api/oauth/register
 *
 * Registers a PUBLIC client (no secret, PKCE S256) for an MCP connector. The
 * rules (redirect allowlist, scope ceiling) live in src/lib/oauth/dcr.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { parseRegistration } from '@/lib/oauth/dcr';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function dcrError(error: string, description: string, status = 400, headers: Record<string, string> = {}) {
  return NextResponse.json({ error, error_description: description }, { status, headers: { ...NO_STORE, ...headers } });
}

export async function POST(request: NextRequest) {
  const limit = await checkRateLimitAsync(getClientIp(request), 'oauth_register');
  if (!limit.allowed) {
    const retry = Math.max(1, limit.resetAt - Math.floor(Date.now() / 1000));
    return dcrError('slow_down', 'Too many client registrations from this address; try again later', 429, {
      'Retry-After': String(retry),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return dcrError('invalid_client_metadata', 'Request body must be JSON');
  }

  const parsed = parseRegistration(body);
  if (!parsed.ok) return dcrError(parsed.error.error, parsed.error.error_description);
  const meta = parsed.client;

  const clientId = 'cp_' + randomBytes(12).toString('hex');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await supabase
    .from('oauth_clients')
    .insert({
      client_id: clientId,
      client_secret: '',
      name: meta.client_name,
      description: meta.client_uri
        ? `Registered by dynamic client registration (${meta.client_uri})`
        : 'Registered by dynamic client registration',
      redirect_uris: meta.redirect_uris,
      scopes: meta.scopes,
      owner_id: null,
      is_active: true,
      token_endpoint_auth_method: 'none',
      grant_types: meta.grant_types,
      require_pkce: true,
      id_token_signed_response_alg: 'RS256',
      legacy_oauth2: false,
    })
    .select('client_id, created_at')
    .single();

  if (error || !data) {
    console.error('[OAuth DCR] insert failed:', error?.message, error?.code);
    return dcrError('server_error', 'Could not register the client', 500);
  }

  console.log(`[OAuth DCR] registered ${clientId} "${meta.client_name}" redirects=${meta.redirect_uris.join(',')}`);

  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(new Date(data.created_at ?? Date.now()).getTime() / 1000),
      client_name: meta.client_name,
      redirect_uris: meta.redirect_uris,
      grant_types: meta.grant_types,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: meta.scopes.join(' '),
      ...(meta.client_uri ? { client_uri: meta.client_uri } : {}),
    },
    { status: 201, headers: NO_STORE }
  );
}

export async function GET() {
  return dcrError('invalid_request', 'Register a client with POST (RFC 7591)', 405, { Allow: 'POST' });
}
