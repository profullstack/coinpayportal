/**
 * OAuth2 Authorization Endpoint
 * GET  — validate params, check auth, redirect to consent or issue code
 * POST — handle consent approval, generate auth code
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateClient } from '@/lib/oauth/client';
import { validateScopes } from '@/lib/oauth/scopes';
import { generateAuthorizationCode } from '@/lib/oauth/tokens';
import { verifyToken } from '@/lib/auth/jwt';

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

/**
 * Extract authenticated user from request cookies/headers
 */
async function getAuthenticatedUser(request: NextRequest): Promise<{ id: string; email?: string } | null> {
  // Try Authorization header first
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) return null;
      const decoded = verifyToken(token, secret);
      if (decoded?.userId) {
        return { id: decoded.userId, email: decoded.email };
      }
    } catch {
      // Fall through
    }
  }

  // Try cookie-based session
  const sessionCookie = request.cookies.get('session')?.value
    || request.cookies.get('token')?.value;
  if (sessionCookie) {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) return null;
      const decoded = verifyToken(sessionCookie, secret);
      if (decoded?.userId) {
        return { id: decoded.userId, email: decoded.email };
      }
    } catch {
      // Not authenticated
    }
  }

  return null;
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

  // Validate scopes
  const scopes = validateScopes(scope);
  if (scopes.length === 0) {
    return oauthError(redirectUri, 'invalid_scope', 'No valid scopes requested', state);
  }

  // Check authentication
  const user = await getAuthenticatedUser(request);
  if (!user) {
    // Redirect to login with return URL
    const publicOrigin = getPublicOrigin(url);
    const returnUrl = url.pathname + url.search;
    const loginUrl = new URL('/login', publicOrigin);
    loginUrl.searchParams.set('redirect', returnUrl);
    return NextResponse.redirect(loginUrl.toString(), 302);
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
    if (allConsented) {
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
  const user = await getAuthenticatedUser(request);
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

  const scopes = validateScopes(scope || 'openid');
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
