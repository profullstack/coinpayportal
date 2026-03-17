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
 * Filter requested scopes to only valid ones.
 * Always includes 'openid' if any valid scope is present.
 */
export function validateScopes(requested: string | string[]): string[] {
  const scopeList = Array.isArray(requested)
    ? requested
    : requested.split(/\s+/).filter(Boolean);

  const valid = scopeList.filter((s) =>
    (VALID_SCOPES as readonly string[]).includes(s)
  );

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
