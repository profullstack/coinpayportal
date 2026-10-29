/**
 * OAuth2/OIDC Token generation and verification
 */
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { getRsaSigningKey } from './signing';

/** Access-token lifetime in seconds. Revocation rows only need to outlive this. */
export const ACCESS_TOKEN_TTL = 3600;

const MIN_OIDC_SECRET_LENGTH = 32;

/**
 * The OAuth/OIDC token signing secret. It must be its own value.
 *
 * It used to fall back to JWT_SECRET, which in production equals the Supabase
 * JWT secret: every access token CoinPay issued (with `sub` set) was then also
 * a valid PostgREST JWT, so auth.uid() resolved to the user and table policies
 * applied (#511). In production there is no fallback at all, and a value that
 * equals JWT_SECRET or the Supabase JWT secret is refused. Outside production
 * the JWT_SECRET fallback stays so local dev and tests need no extra setup.
 */
export function getSigningSecret(): string {
  const env = process.env;
  const own = env.OIDC_SIGNING_SECRET;
  if (env.NODE_ENV === 'production') {
    if (!own || own.length < MIN_OIDC_SECRET_LENGTH) {
      throw new Error(
        `OIDC_SIGNING_SECRET must be set (>= ${MIN_OIDC_SECRET_LENGTH} chars) in production`
      );
    }
    const reused = [env.JWT_SECRET, env.SUPABASE_JWT_SECRET].filter(Boolean);
    if (reused.includes(own)) {
      throw new Error('OIDC_SIGNING_SECRET must not equal JWT_SECRET or SUPABASE_JWT_SECRET');
    }
    return own;
  }
  const secret = own || env.JWT_SECRET;
  if (!secret) {
    throw new Error('OIDC_SIGNING_SECRET must be set');
  }
  return secret;
}

/** Fail closed at boot: throws when production has no usable OIDC secret. */
export function assertOidcSigningSecret(): void {
  getSigningSecret();
}

function getIssuer(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://coinpay.dev';
}

/**
 * Generate a cryptographically random authorization code (64-char hex)
 */
export function generateAuthorizationCode(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a cryptographically random refresh token (64-char hex)
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate an OAuth2 access token (JWT)
 */
export function generateAccessToken(
  user: { id: string; email?: string },
  client: { client_id: string },
  scopes: string[],
  opts: { sid?: string | null; jti?: string } = {}
): string {
  const secret = getSigningSecret();
  const payload: Record<string, unknown> = {
    sub: user.id,
    client_id: client.client_id,
    // The token is for the app it was issued to. CoinPay's own APIs accept it
    // regardless of aud (they gate on scope); a relying party that receives a
    // bearer from elsewhere checks aud === its own client_id.
    aud: client.client_id,
    scope: scopes.join(' '),
    token_type: 'access',
    iss: getIssuer(),
    // jti revokes this one token; sid (the refresh-token family) revokes the
    // whole grant. See src/lib/oauth/grants.ts.
    jti: opts.jti || randomBytes(16).toString('base64url'),
  };
  if (opts.sid) payload.sid = opts.sid;

  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

/**
 * Generate an OIDC ID token (JWT)
 */
export function generateIdToken(
  user: { id: string; email?: string; name?: string; picture?: string; email_verified?: boolean },
  client: { client_id: string },
  scopes: string[],
  nonce?: string | null,
  opts: { alg?: 'RS256' | 'HS256' } = {}
): string {
  const now = Math.floor(Date.now() / 1000);

  const payload: Record<string, any> = {
    iss: getIssuer(),
    sub: user.id,
    aud: client.client_id,
    iat: now,
    exp: now + 3600,
  };

  if (nonce) {
    payload.nonce = nonce;
  }

  if (scopes.includes('email') && user.email) {
    payload.email = user.email;
    payload.email_verified = user.email_verified ?? false;
  }

  if (scopes.includes('profile')) {
    if (user.name) payload.name = user.name;
    if (user.picture) payload.picture = user.picture;
  }

  // azp: the party the ID token was issued to (OIDC Core 2).
  payload.azp = client.client_id;

  // RS256 when the client asks for it (the default for clients registered from
  // 2026-10-29) and a key is configured; otherwise HS256 as before.
  if (opts.alg === 'RS256') {
    const key = getRsaSigningKey();
    if (key) {
      return jwt.sign(payload, key.privateKey, { algorithm: 'RS256', keyid: key.kid });
    }
  }
  return jwt.sign(payload, getSigningSecret(), { algorithm: 'HS256' });
}

/**
 * Verify and decode an OAuth2 access token
 */
export function verifyAccessToken(token: string): any {
  const secret = getSigningSecret();
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && decoded.token_type !== 'access') {
      throw new Error('Not an access token');
    }
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Verify an access token's signature but not its expiry, for revocation: an
 * expired token is still a valid thing to revoke (it is a no-op).
 */
export function verifyAccessTokenSignature(token: string): Record<string, any> | null {
  try {
    const decoded = jwt.verify(token, getSigningSecret(), { algorithms: ['HS256'], ignoreExpiration: true });
    if (!decoded || typeof decoded !== 'object' || decoded.token_type !== 'access') return null;
    return decoded as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * Validate PKCE code_verifier against code_challenge
 */
export function validatePKCE(
  codeVerifier: string,
  codeChallenge: string,
  method: string = 'S256'
): boolean {
  // Only S256 is accepted.
  //
  // 'plain' used to be honoured, and it offers no protection at all: the
  // challenge IS the verifier, so anyone who observes the authorization request
  // (a redirect through a browser, a proxy log, a referrer header) can complete
  // the code exchange. RFC 7636 permits 'plain' only for clients that cannot
  // compute SHA-256 — not a description of anything integrating with this
  // server — and downgrading to it is the standard way to defeat PKCE.
  if (method !== 'S256') {
    return false;
  }

  const hash = createHash('sha256').update(codeVerifier).digest();
  const computed = hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Constant-time: the challenge is attacker-supplied and the comparison is
  // over a value derived from the verifier.
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
