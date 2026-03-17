/**
 * OIDC Discovery Document
 * GET /.well-known/openid-configuration
 */
import { NextResponse } from 'next/server';

export async function GET() {
  const issuer = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpay.dev';

  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    userinfo_endpoint: `${issuer}/api/oauth/userinfo`,
    jwks_uri: `${issuer}/api/oauth/jwks`,
    registration_endpoint: `${issuer}/api/oauth/clients`,
    scopes_supported: ['openid', 'profile', 'email', 'did', 'wallet:read'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256', 'plain'],
    claims_supported: [
      'sub',
      'name',
      'preferred_username',
      'email',
      'email_verified',
      'picture',
      'updated_at',
      'did',
    ],
  });
}
