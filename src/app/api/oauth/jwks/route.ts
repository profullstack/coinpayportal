/**
 * JWKS Endpoint
 * GET /api/oauth/jwks
 *
 * Since we use HS256 (symmetric), we return a hint about the key type.
 * Clients using HS256 need the shared secret to verify tokens.
 */
import { NextResponse } from 'next/server';
import { getRsaSigningKey } from '@/lib/oauth/signing';

export const dynamic = 'force-dynamic';

export async function GET() {
  // The key id must NOT be derived from the signing secret.
  //
  // This published `sha256(secret)` truncated to 16 hex characters — 64 bits of
  // the hash of the signing key — on an unauthenticated endpoint. That hands an
  // attacker an offline oracle: guess a JWT_SECRET, hash it, compare against the
  // published kid. No requests, no rate limit, no logs, and a confirmed hit
  // means they can mint tokens. It converts "is the secret guessable?" from a
  // question requiring an online attack into one answerable on a laptop.
  //
  // A key id only needs to be stable and unique per key, so it is configured
  // rather than derived. Rotating the signing key means setting a new
  // OIDC_KEY_ID alongside it.
  const kid = process.env.OIDC_KEY_ID?.trim() || 'coinpay-oidc-hs256';

  // RS256 public key first: ID tokens for clients registered from 2026-10-29
  // are RS256 and verifiable against it. The HS256 entry stays as a hint (no
  // key material) for clients still on HS256 ID tokens.
  const keys: Record<string, string>[] = [];
  let rsa = null;
  try {
    rsa = getRsaSigningKey();
  } catch (err) {
    console.error('[OIDC] OIDC_RS256_PRIVATE_KEY is unreadable:', err instanceof Error ? err.message : err);
  }
  if (rsa) keys.push(rsa.publicJwk);
  keys.push({ kty: 'oct', kid, use: 'sig', alg: 'HS256' });

  return NextResponse.json({ keys }, { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
