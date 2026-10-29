/** Shared by /.well-known/openid-configuration and /.well-known/oauth-authorization-server (RFC 8414). */
import { VALID_SCOPES } from './scopes';
import { SUPPORTED_GRANT_TYPES, TOKEN_ENDPOINT_AUTH_METHODS } from './client';
import { supportedIdTokenAlgs } from './signing';

export function issuer(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://coinpay.dev';
}

export function authorizationServerMetadata(): Record<string, unknown> {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/api/oauth/authorize`,
    token_endpoint: `${iss}/api/oauth/token`,
    userinfo_endpoint: `${iss}/api/oauth/userinfo`,
    jwks_uri: `${iss}/api/oauth/jwks`,
    registration_endpoint: `${iss}/api/oauth/clients`,
    revocation_endpoint: `${iss}/api/oauth/revoke`,
    device_authorization_endpoint: `${iss}/api/oauth/device_authorization`,
    scopes_supported: [...VALID_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: [...SUPPORTED_GRANT_TYPES],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: supportedIdTokenAlgs(),
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    // validatePKCE rejects 'plain' (the challenge would equal the verifier).
    code_challenge_methods_supported: ['S256'],
    prompt_values_supported: ['none', 'login', 'consent', 'select_account'],
    claims_supported: ['sub', 'iss', 'aud', 'azp', 'exp', 'iat', 'nonce', 'name', 'email', 'email_verified', 'updated_at', 'did', 'wallets'],
    request_parameter_supported: false,
    authorization_response_iss_parameter_supported: false,
    service_documentation: `${iss}/docs/oauth`,
  };
}
