/**
 * OAuth2/OIDC Token generation and verification
 */
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';

function getSigningSecret(): string {
  const secret = process.env.OIDC_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('OIDC_SIGNING_SECRET or JWT_SECRET must be set');
  }
  return secret;
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
  scopes: string[]
): string {
  const secret = getSigningSecret();
  const payload = {
    sub: user.id,
    client_id: client.client_id,
    scope: scopes.join(' '),
    token_type: 'access',
    iss: getIssuer(),
  };

  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

/**
 * Generate an OIDC ID token (JWT)
 */
export function generateIdToken(
  user: { id: string; email?: string; name?: string; picture?: string; email_verified?: boolean },
  client: { client_id: string },
  scopes: string[],
  nonce?: string | null
): string {
  const secret = getSigningSecret();
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

  return jwt.sign(payload, secret, { algorithm: 'HS256' });
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
 * Validate PKCE code_verifier against code_challenge
 */
export function validatePKCE(
  codeVerifier: string,
  codeChallenge: string,
  method: string = 'S256'
): boolean {
  if (method === 'S256') {
    const hash = createHash('sha256').update(codeVerifier).digest();
    const computed = hash
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return computed === codeChallenge;
  }

  if (method === 'plain') {
    return codeVerifier === codeChallenge;
  }

  return false;
}
