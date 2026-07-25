/**
 * Bearer-token resolution for API routes that serve both the dashboard and
 * third-party OAuth2/OIDC clients.
 *
 * Two kinds of HS256 JWT arrive on `Authorization: Bearer …`:
 *   - dashboard session tokens, signed with JWT_SECRET, subject in `userId`;
 *   - OAuth2 access tokens, signed with OIDC_SIGNING_SECRET (falling back to
 *     JWT_SECRET), subject in `sub`, with `token_type: 'access'` and a `scope`.
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

function classify(decoded: unknown): BearerAuthOk | null {
  if (!decoded || typeof decoded !== 'object') return null;
  const payload = decoded as Record<string, unknown>;

  if (payload.token_type === 'access' && typeof payload.sub === 'string' && payload.sub) {
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    return {
      ok: true,
      userId: payload.sub,
      kind: 'oauth',
      scopes: scope.split(' ').filter(Boolean),
    };
  }

  if (typeof payload.userId === 'string' && payload.userId) {
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

  // Session secret first: the common case, and it also decodes OAuth tokens
  // whenever OIDC_SIGNING_SECRET is unset and falls back to JWT_SECRET.
  try {
    const resolved = classify(verifyToken(token, getJwtSecret()));
    if (resolved) return resolved;
  } catch {
    // Fall through to the OAuth signing secret.
  }

  try {
    const resolved = classify(verifyAccessToken(token));
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
