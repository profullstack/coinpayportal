/**
 * OAuth 2.0 Token Revocation (RFC 7009)
 * POST /api/oauth/revoke  token=…&token_type_hint=refresh_token|access_token
 *
 * Confidential clients authenticate (Basic or post); public clients send
 * client_id. A token that is unknown, already revoked or belongs to another
 * client gets the same 200 as a successful revocation (RFC 7009 2.2), so the
 * endpoint is not an oracle.
 *  - refresh token: the whole grant (family) is revoked, including access
 *    tokens minted for it.
 *  - access token: that token (jti) is revoked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashToken, isPresentableToken } from '@/lib/crypto/token-hash';
import { applyBasicAuth, authenticateTokenClient, parseFormOrJson } from '@/lib/oauth/client-auth';
import { revokeAccessTokenJti, revokeFamily } from '@/lib/oauth/grants';
import { verifyAccessTokenSignature } from '@/lib/oauth/tokens';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(request: NextRequest) {
  const rate = await checkRateLimitAsync(getClientIp(request), 'oauth_revoke');
  if (!rate.allowed) {
    return NextResponse.json({ error: 'slow_down', error_description: 'Too many requests' }, { status: 429, headers: NO_STORE });
  }

  const body = applyBasicAuth(request, await parseFormOrJson(request));
  const token = body.token;
  if (!token) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'token is required' }, { status: 400, headers: NO_STORE });
  }
  const auth = await authenticateTokenClient(body);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, error_description: auth.description }, { status: auth.status, headers: NO_STORE });
  }
  const clientId = auth.client.client_id;
  const supabase = getSupabase();
  const hint = body.token_type_hint;

  const tryAccess = async () => {
    const decoded = verifyAccessTokenSignature(token);
    if (!decoded || decoded.client_id !== clientId) return false;
    if (typeof decoded.jti === 'string') await revokeAccessTokenJti(supabase, decoded.jti, clientId, decoded.exp);
    return true;
  };
  const tryRefresh = async () => {
    if (!isPresentableToken(token) || token.includes('.')) return false;
    const { data: row } = await supabase
      .from('oauth_refresh_tokens')
      .select('id, family_id')
      .eq('client_id', clientId)
      .in('token', [hashToken(token), token])
      .maybeSingle();
    if (!row) return false;
    await revokeFamily(supabase, row.family_id || row.id, clientId, 'revoked_by_client');
    return true;
  };

  try {
    if (hint === 'access_token') {
      if (!(await tryAccess())) await tryRefresh();
    } else if (!(await tryRefresh())) {
      await tryAccess();
    }
  } catch (err) {
    console.error('[OAuth] revoke failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'server_error', error_description: 'Revocation failed; retry' }, { status: 503, headers: NO_STORE });
  }
  return new NextResponse(null, { status: 200, headers: NO_STORE });
}
