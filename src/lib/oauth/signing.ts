/**
 * Asymmetric ID-token signing (RS256), published at the JWKS endpoint.
 *
 * HS256 ID tokens are MACed with CoinPay's own OIDC secret, so no relying
 * party can verify them (OIDC would use the client's secret; we never did).
 * RS256 lets any app verify an ID token offline against /api/oauth/jwks.
 *
 * The private key comes from OIDC_RS256_PRIVATE_KEY: a PKCS#8 or PKCS#1 PEM,
 * or that PEM base64-encoded (env files do not carry newlines well). The key
 * id is the RFC 7638 thumbprint of the public key unless OIDC_RS256_KEY_ID is
 * set, so it is stable and reveals nothing secret.
 */
import { createHash, createPrivateKey, createPublicKey, KeyObject } from 'crypto';

export type RsaSigningKey = { privateKey: KeyObject; kid: string; publicJwk: Record<string, string> };

let cached: { source: string; key: RsaSigningKey | null } | null = null;

function readPem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed.replace(/\\n/g, '\n');
  return Buffer.from(trimmed, 'base64').toString('utf8');
}

/** RFC 7638 JWK thumbprint (SHA-256, base64url) of an RSA public key. */
export function rsaThumbprint(jwk: { e: string; n: string }): string {
  const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
  return createHash('sha256').update(canonical).digest('base64url');
}

/** The configured RS256 key, or null when none is set. Throws on a malformed key. */
export function getRsaSigningKey(): RsaSigningKey | null {
  const source = process.env.OIDC_RS256_PRIVATE_KEY || '';
  if (cached && cached.source === source) return cached.key;
  if (!source.trim()) {
    cached = { source, key: null };
    return null;
  }
  const privateKey = createPrivateKey(readPem(source));
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('OIDC_RS256_PRIVATE_KEY must be an RSA key');
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  const kid = process.env.OIDC_RS256_KEY_ID?.trim() || rsaThumbprint(jwk);
  const key: RsaSigningKey = {
    privateKey,
    kid,
    publicJwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, use: 'sig', alg: 'RS256' },
  };
  cached = { source, key };
  return key;
}

/** Test hook. */
export function resetSigningKeyCache(): void {
  cached = null;
}

/** ID-token algorithms this deployment can sign with, RS256 first when configured. */
export function supportedIdTokenAlgs(): string[] {
  let rsa = false;
  try {
    rsa = getRsaSigningKey() !== null;
  } catch {
    rsa = false;
  }
  return rsa ? ['RS256', 'HS256'] : ['HS256'];
}
