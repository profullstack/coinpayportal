import { verifyAccessToken } from '../oauth/tokens';

/**
 * The merchant an OAuth 2.1 access token speaks for, when it may.
 *
 * The CoinPay CLI signs in with authorization code + PKCE and then calls the
 * merchant API with the access token as a bearer. That token is accepted where
 * the session JWT is, but only when its grant carries the `merchant` scope: a
 * token issued to a third-party app for `openid profile` must not open the
 * merchant API. Bearer only, never a cookie.
 */
export function merchantFromAccessToken(token: string | null | undefined): { id: string; clientId: string | null } | null {
  if (!token) return null;
  try {
    const decoded = verifyAccessToken(token);
    const scopes = typeof decoded?.scope === 'string' ? decoded.scope.split(/\s+/) : [];
    if (!scopes.includes('merchant') || typeof decoded.sub !== 'string' || !decoded.sub) return null;
    return { id: decoded.sub, clientId: typeof decoded.client_id === 'string' ? decoded.client_id : null };
  } catch {
    return null;
  }
}
