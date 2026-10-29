/**
 * OAuth2 Authorization Endpoint
 * GET  — validate params, check auth, redirect to consent or issue code
 * POST — handle consent approval, generate auth code
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateClient, clientGrantTypes } from '@/lib/oauth/client';
import { pkceProblem } from '@/lib/oauth/pkce';
import { validateScopes } from '@/lib/oauth/scopes';
import { generateAuthorizationCode } from '@/lib/oauth/tokens';
import { getSessionUser } from '@/lib/oauth/session-user';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function oauthError(redirectUri: string, error: string, description: string, state?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url.toString(), 302);
}

/**
 * Get the public-facing origin for redirects.
 * Behind a reverse proxy, request.url may be localhost:PORT — use APP_URL instead.
 */
function getPublicOrigin(requestUrl: URL): string {
  return process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin;
}

/** The authorize URL as a same-origin path, with some `prompt` values dropped. */
function authorizePathWithout(url: URL, drop: string[]): string {
  const next = new URL(url.toString());
  const kept = (next.searchParams.get('prompt') || '').split(' ').filter((p) => p && !drop.includes(p));
  if (kept.length) next.searchParams.set('prompt', kept.join(' '));
  else next.searchParams.delete('prompt');
  return next.pathname + next.search;
}

function loginRedirect(url: URL, returnPath: string) {
  const loginUrl = new URL('/login', getPublicOrigin(url));
  loginUrl.searchParams.set('redirect', returnPath);
  return NextResponse.redirect(loginUrl.toString(), 302);
}

/**
 * GET /api/oauth/authorize
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const responseType = url.searchParams.get('response_type');
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const scope = url.searchParams.get('scope') || 'openid';
  const state = url.searchParams.get('state') || undefined;
  const codeChallenge = url.searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || undefined;
  const nonce = url.searchParams.get('nonce') || undefined;
  // OIDC `prompt`: login (sign in again), select_account / consent (always ask,
  // never approve silently), none (never show a page).
  const prompt = new Set((url.searchParams.get('prompt') || '').split(' ').filter(Boolean));

  // Validate required params
  if (responseType !== 'code') {
    return NextResponse.json(
      { error: 'unsupported_response_type', error_description: 'Only response_type=code is supported' },
      { status: 400 }
    );
  }

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'client_id and redirect_uri are required' },
      { status: 400 }
    );
  }

  // Validate client
  const clientResult = await validateClient(clientId, redirectUri);
  if (!clientResult.valid || !clientResult.client) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: clientResult.error || 'Invalid client' },
      { status: 400 }
    );
  }

  // R4-ID-OAUTH: an authorization request must be bound to the browser that
  // started it (state or PKCE), and under OAuth 2.1 by PKCE for every client
  // that requires it. A direct 400, not a redirect: nothing binds the request.
  if (!clientGrantTypes(clientResult.client).includes('authorization_code')) {
    return NextResponse.json(
      { error: 'unauthorized_client', error_description: 'This client may not use the authorization code flow' },
      { status: 400 }
    );
  }
  const pkceError = pkceProblem(clientResult.client, codeChallenge, codeChallengeMethod, state);
  if (pkceError) {
    return NextResponse.json({ error: 'invalid_request', error_description: pkceError }, { status: 400 });
  }

  // Validate scopes against BOTH the global whitelist and this client's own
  // registration. Checking only the whitelist let any registered client request
  // every scope the platform defines, regardless of what it was approved for.
  const scopes = validateScopes(scope, clientResult.client.scopes);
  if (scopes.length === 0) {
    return oauthError(redirectUri, 'invalid_scope', 'No valid scopes requested for this client', state);
  }

  if (prompt.has('none') && prompt.size > 1) {
    return oauthError(redirectUri, 'invalid_request', 'prompt=none cannot be combined with other prompt values', state);
  }

  // Check authentication
  const user = await getSessionUser(request);
  if (!user) {
    if (prompt.has('none')) return oauthError(redirectUri, 'login_required', 'User is not signed in', state);
    // Signing in here already picks the account, so do not ask again after.
    return loginRedirect(url, authorizePathWithout(url, ['login', 'select_account']));
  }

  // Sign in again even with a session: the way to reach a different account.
  if (prompt.has('login')) {
    return loginRedirect(url, authorizePathWithout(url, ['login', 'select_account']));
  }

  // Check existing consent
  const supabase = getSupabase();
  const { data: existingConsent } = await supabase
    .from('oauth_consents')
    .select('scopes')
    .eq('user_id', user.id)
    .eq('client_id', clientId)
    .single();

  if (existingConsent) {
    // Check if all requested scopes are already consented
    const allConsented = scopes.every((s) => existingConsent.scopes.includes(s));
    // select_account and consent always show the consent screen, which names
    // the signed-in account and offers a different one.
    if (allConsented && !prompt.has('select_account') && !prompt.has('consent')) {
      // Generate code directly
      const code = generateAuthorizationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const codeRecord: Record<string, any> = {
        code,
        client_id: clientId,
        user_id: user.id,
        redirect_uri: redirectUri,
        scopes,
        code_challenge: codeChallenge || null,
        code_challenge_method: codeChallengeMethod || null,
        expires_at: expiresAt,
      };
      if (nonce) codeRecord.nonce = nonce;

      await supabase.from('oauth_authorization_codes').insert(codeRecord);

      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('code', code);
      if (state) callbackUrl.searchParams.set('state', state);
      return NextResponse.redirect(callbackUrl.toString(), 302);
    }
  }

  if (prompt.has('none')) return oauthError(redirectUri, 'consent_required', 'User has not approved this app', state);

  // Redirect to consent page
  const consentUrl = new URL('/oauth/consent', getPublicOrigin(url));
  consentUrl.searchParams.set('client_id', clientId);
  consentUrl.searchParams.set('redirect_uri', redirectUri);
  consentUrl.searchParams.set('scope', scopes.join(' '));
  if (state) consentUrl.searchParams.set('state', state);
  if (codeChallenge) consentUrl.searchParams.set('code_challenge', codeChallenge);
  if (codeChallengeMethod) consentUrl.searchParams.set('code_challenge_method', codeChallengeMethod);
  if (nonce) consentUrl.searchParams.set('nonce', nonce);
  return NextResponse.redirect(consentUrl.toString(), 302);
}

/**
 * POST /api/oauth/authorize — consent approval
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Invalid request body' },
      { status: 400 }
    );
  }

  const {
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    nonce,
    action,
  } = body;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'client_id and redirect_uri are required' },
      { status: 400 }
    );
  }

  // Validate client
  const clientResult = await validateClient(clientId, redirectUri);
  if (!clientResult.valid) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: clientResult.error || 'Invalid client' },
      { status: 400 }
    );
  }

  // Check user authentication
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'login_required', error_description: 'User is not authenticated' },
      { status: 401 }
    );
  }

  // User denied consent — return JSON with redirect URL for client-side navigation
  if (action === 'deny') {
    const denyUrl = new URL(redirectUri);
    denyUrl.searchParams.set('error', 'access_denied');
    denyUrl.searchParams.set('error_description', 'User denied the request');
    if (state) denyUrl.searchParams.set('state', state);
    return NextResponse.json({ redirect: denyUrl.toString() });
  }

  // Same constraint as the GET path: the consent POST must not be a way to
  // grant a client scopes it was never registered for.
  const scopes = validateScopes(scope || 'openid', clientResult.client?.scopes);
  if (scopes.length === 0) {
    return NextResponse.json(
      { error: 'invalid_scope', error_description: 'No valid scopes requested for this client' },
      { status: 400 }
    );
  }

  // Same PKCE policy as GET: the consent POST must not be a way around it.
  const pkceError = pkceProblem(clientResult.client!, codeChallenge, codeChallengeMethod, state);
  if (pkceError) {
    return NextResponse.json({ error: 'invalid_request', error_description: pkceError }, { status: 400 });
  }

  const supabase = getSupabase();

  // Save consent
  await supabase.from('oauth_consents').upsert(
    {
      user_id: user.id,
      client_id: clientId,
      scopes,
    },
    { onConflict: 'user_id,client_id' }
  );

  // Generate authorization code
  const code = generateAuthorizationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const consentCodeRecord: Record<string, any> = {
    code,
    client_id: clientId,
    user_id: user.id,
    redirect_uri: redirectUri,
    scopes,
    code_challenge: codeChallenge || null,
    code_challenge_method: codeChallengeMethod || null,
    expires_at: expiresAt,
  };
  if (nonce) consentCodeRecord.nonce = nonce;

  await supabase.from('oauth_authorization_codes').insert(consentCodeRecord);

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);
  if (state) callbackUrl.searchParams.set('state', state);

  return NextResponse.json({
    redirect: callbackUrl.toString(),
  });
}
