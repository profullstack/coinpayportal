import { verifyAccessToken } from '../oauth/tokens';
import { isAccessTokenRevoked } from '../oauth/grants';

/**
 * The merchant an OAuth 2.1 access token speaks for, when it may.
 *
 * The CoinPay CLI signs in with authorization code + PKCE and then calls the
 * merchant API with the access token as a bearer. That token is accepted where
 * the session JWT is, but only when its grant carries the `merchant` scope: a
 * token issued to a third-party app for `openid profile` must not open the
 * merchant API. Bearer only, never a cookie.
 */
export function merchantFromAccessToken(
  token: string | null | undefined
): { id: string; clientId: string | null; jti?: string; sid?: string } | null {
  if (!token) return null;
  try {
    const decoded = verifyAccessToken(token);
    const scopes = typeof decoded?.scope === 'string' ? decoded.scope.split(/\s+/) : [];
    if (!scopes.includes('merchant') || typeof decoded.sub !== 'string' || !decoded.sub) return null;
    return {
      id: decoded.sub,
      clientId: typeof decoded.client_id === 'string' ? decoded.client_id : null,
      jti: typeof decoded.jti === 'string' ? decoded.jti : undefined,
      sid: typeof decoded.sid === 'string' ? decoded.sid : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * merchantFromAccessToken plus the revocation list (RFC 7009): a token the
 * client revoked, or one from a grant revoked for refresh-token reuse, stops
 * working here at once instead of at expiry. Fails closed.
 */
export async function merchantFromLiveAccessToken(
  token: string | null | undefined,
  db: Parameters<typeof isAccessTokenRevoked>[0]
): Promise<ReturnType<typeof merchantFromAccessToken>> {
  const oauth = merchantFromAccessToken(token);
  if (!oauth) return null;
  try {
    if (await isAccessTokenRevoked(db, oauth)) return null;
  } catch {
    return null;
  }
  return oauth;
}
