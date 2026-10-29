import { clientRequiresPkce, type OAuthClient } from './client';

/**
 * OAuth 2.1 PKCE policy for one authorization request. Returns an error
 * description, or null when the request is acceptable.
 *
 * - Only S256. An explicit `plain` (or anything else) is refused. A missing
 *   method with a challenge is read as S256, as it always has been here.
 * - Public clients and every client registered from 2026-10-29 must send a
 *   code_challenge. Pre-2.1 clients that have sent requests without PKCE keep
 *   the old rule: state or PKCE (see the migration and the PR for the list).
 */
export function pkceProblem(
  client: Pick<OAuthClient, 'require_pkce' | 'client_secret' | 'token_endpoint_auth_method'>,
  codeChallenge: string | undefined,
  codeChallengeMethod: string | undefined,
  state: string | undefined
): string | null {
  if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return `Unsupported code_challenge_method: ${codeChallengeMethod}. Only S256 is accepted.`;
  }
  if (codeChallengeMethod && !codeChallenge) return 'code_challenge_method sent without code_challenge';
  if (codeChallenge && !/^[A-Za-z0-9\-._~]{43,128}$/.test(codeChallenge)) return 'Malformed code_challenge';
  if (clientRequiresPkce(client)) {
    if (!codeChallenge) return 'code_challenge (PKCE, S256) is required for this client';
    return null;
  }
  if (!state && !codeChallenge) {
    return 'Either state or code_challenge (PKCE) is required to bind the authorization request';
  }
  return null;
}

