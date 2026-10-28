/**
 * Bearer-token resolution for API routes that serve both the dashboard and
 * third-party OAuth2/OIDC clients.
 *
 * Two kinds of HS256 JWT arrive on `Authorization: Bearer …`:
 *   - dashboard session tokens, signed with JWT_SECRET, subject in `userId`;
 *   - OAuth2 access tokens, signed with OIDC_SIGNING_SECRET (never JWT_SECRET
 *     in production), subject in `sub`, with `token_type: 'access'` and a `scope`.
 *
 * Routes that only ever read `decoded.userId` silently resolve `undefined` for
 * an OAuth token — the caller looks authenticated but is scoped to nobody. This
 * helper classifies the token instead, so routes can authorize both and gate on
 * scope.
 */

import { verifyToken } from './jwt';
import { getJwtSecret } from '@/lib/secrets';
import { verifyAccessToken } from '@/lib/oauth/tokens';

export type BearerAuthOk = {
  ok: true;
  userId: string;
  kind: 'session' | 'oauth';
  /** Granted OAuth scopes; null for dashboard session tokens (full access). */
  scopes: string[] | null;
};

export type BearerAuthErr = {
  ok: false;
  status: number;
  error: string;
  /** Value for a `WWW-Authenticate` response header, per RFC 6750. */
  wwwAuthenticate?: string;
};

export type BearerAuth = BearerAuthOk | BearerAuthErr;

function classify(decoded: unknown, kind: 'session' | 'oauth'): BearerAuthOk | null {
  if (!decoded || typeof decoded !== 'object') return null;
  const payload = decoded as Record<string, unknown>;

  if (kind === 'oauth' && payload.token_type === 'access' && typeof payload.sub === 'string' && payload.sub) {
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    return {
      ok: true,
      userId: payload.sub,
      kind: 'oauth',
      scopes: scope.split(' ').filter(Boolean),
    };
  }

  if (kind === 'session' && payload.token_type !== 'access' && typeof payload.userId === 'string' && payload.userId) {
    return { ok: true, userId: payload.userId, kind: 'session', scopes: null };
  }

  return null;
}

/**
 * Resolve an `Authorization` header into an authenticated user, accepting
 * either a dashboard session token or an OAuth2 access token.
 */
export function resolveBearerAuth(authHeader: string | null | undefined): BearerAuth {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: 'Missing authorization header',
      wwwAuthenticate: 'Bearer',
    };
  }

  const token = authHeader.substring(7);

  // Each secret only vouches for its own kind of token: an OAuth-shaped token
  // signed with the session secret (JWT_SECRET) is not an OAuth token.
  try {
    const resolved = classify(verifyToken(token, getJwtSecret()), 'session');
    if (resolved) return resolved;
  } catch {
    // Fall through to the OAuth signing secret.
  }

  try {
    const resolved = classify(verifyAccessToken(token), 'oauth');
    if (resolved) return resolved;
  } catch {
    // Neither secret verified it.
  }

  return {
    ok: false,
    status: 401,
    error: 'Invalid or expired token',
    wwwAuthenticate: 'Bearer error="invalid_token"',
  };
}

/**
 * True when the caller may exercise `scope`. Dashboard sessions always may;
 * OAuth clients only if the user granted it at consent.
 */
export function hasScope(auth: BearerAuthOk, scope: string): boolean {
  if (auth.scopes === null) return true;
  return auth.scopes.includes(scope);
}

/** OAuth scope that lets a third-party app act on the merchant API. */
export const MERCHANT_SCOPE = 'merchant';

export type MerchantBearerOk = {
  ok: true;
  /** The merchant the caller acts as: session `userId`, or the OAuth `sub`. */
  merchantId: string;
  kind: 'session' | 'oauth';
};

export type MerchantBearerAuth = MerchantBearerOk | BearerAuthErr;

/**
 * Resolve an `Authorization` header to the merchant it may act as, for routes
 * that write merchant state (wallets, business settings, webhook secrets).
 *
 * A dashboard session token is accepted as before. An OAuth2 access token is
 * accepted only when its grant carries the `merchant` scope — the same rule
 * `merchantFromAccessToken` applies for `requireMerchant`/`authenticateRequest`
 * — and then acts as its `sub`, exactly like a session for that merchant: the
 * route's own ownership/role checks still decide what it may touch. An OAuth
 * token without `merchant` (e.g. `openid profile wallet:read`) gets 403
 * insufficient_scope, never silent access.
 */
export function resolveMerchantBearer(authHeader: string | null | undefined): MerchantBearerAuth {
  const auth = resolveBearerAuth(authHeader);
  if (!auth.ok) return auth;
  if (auth.kind === 'oauth' && !hasScope(auth, MERCHANT_SCOPE)) {
    return {
      ok: false,
      status: 403,
      error: `insufficient_scope: this token is missing the '${MERCHANT_SCOPE}' scope`,
      wwwAuthenticate: `Bearer error="insufficient_scope", scope="${MERCHANT_SCOPE}"`,
    };
  }
  return { ok: true, merchantId: auth.userId, kind: auth.kind };
}

/**
 * The `{ success: false, error }` response body and init for a failed
 * `resolveMerchantBearer`, carrying `WWW-Authenticate` when there is one.
 */
export function merchantBearerErrorInit(auth: BearerAuthErr): {
  body: { success: false; error: string };
  init: { status: number; headers?: Record<string, string> };
} {
  return {
    body: { success: false, error: auth.error },
    init: {
      status: auth.status,
      ...(auth.wwwAuthenticate ? { headers: { 'WWW-Authenticate': auth.wwwAuthenticate } } : {}),
    },
  };
}
