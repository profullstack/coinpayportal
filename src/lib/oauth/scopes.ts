/**
 * OAuth2/OIDC Scope definitions and utilities
 */

export const VALID_SCOPES = ['openid', 'profile', 'email', 'did', 'wallet:read'] as const;

export type OAuthScope = (typeof VALID_SCOPES)[number];

/**
 * Human-readable scope descriptions for consent screen
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'Access your name and profile picture',
  email: 'Access your email address',
  did: 'Access your decentralized identifier',
  'wallet:read': 'View your wallet addresses',
};

/**
 * Filter requested scopes down to what this client may actually receive.
 *
 * `allowedScopes` is the client's own registered scope list. Without it the
 * only check was membership of the global VALID_SCOPES whitelist, so any
 * registered client could ask for — and be granted — every scope the platform
 * defines, regardless of what it was registered for. A client approved for
 * `openid profile` could request `wallet:read` and get it.
 *
 * Always includes 'openid' if any valid scope survives.
 *
 * @param allowedScopes the client's registered scopes. Omit ONLY where no
 *        client context exists; passing undefined keeps the old
 *        whitelist-only behaviour and is not safe for an authorization request.
 */
export function validateScopes(
  requested: string | string[],
  allowedScopes?: string[] | null
): string[] {
  const scopeList = Array.isArray(requested)
    ? requested
    : requested.split(/\s+/).filter(Boolean);

  let valid = scopeList.filter((s) =>
    (VALID_SCOPES as readonly string[]).includes(s)
  );

  // Intersect with the client's registration. An empty registered list means
  // the client was registered without scopes, which grants nothing beyond
  // openid rather than everything.
  if (allowedScopes !== undefined && allowedScopes !== null) {
    const permitted = new Set(allowedScopes);
    valid = valid.filter((s) => permitted.has(s) || s === 'openid');
  }

  // Ensure openid is always present if any scope is valid
  if (valid.length > 0 && !valid.includes('openid')) {
    valid.unshift('openid');
  }

  return valid;
}

/**
 * Check if a set of granted scopes includes a required scope.
 */
export function scopeIncludes(granted: string[], required: string): boolean {
  return granted.includes(required);
}
