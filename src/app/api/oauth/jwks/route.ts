/**
 * JWKS Endpoint
 * GET /api/oauth/jwks
 *
 * Since we use HS256 (symmetric), we return a hint about the key type.
 * Clients using HS256 need the shared secret to verify tokens.
 */
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

export async function GET() {
  const secret = process.env.OIDC_SIGNING_SECRET || process.env.JWT_SECRET || '';

  // Generate a key ID from the secret hash (so clients can match keys)
  const kid = createHash('sha256')
    .update(secret)
    .digest('hex')
    .substring(0, 16);

  return NextResponse.json({
    keys: [
      {
        kty: 'oct',
        kid,
        use: 'sig',
        alg: 'HS256',
      },
    ],
  });
}
