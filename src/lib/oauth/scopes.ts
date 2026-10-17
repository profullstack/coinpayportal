/**
 * OAuth2/OIDC Scope definitions and utilities
 */

export const VALID_SCOPES = ['openid', 'profile', 'email', 'did', 'wallet:read', 'merchant'] as const;

export type OAuthScope = (typeof VALID_SCOPES)[number];

export type ScopeInfo = {
  label: string;
  description: string;
  icon: string;
  /**
   * A permission that can spend or redirect the user's money. The consent page
   * sets it apart so it cannot be skimmed past on the way to Authorize.
   */
  sensitive?: boolean;
};

/**
 * What each scope lets an app do, in the words the consent screen shows.
 *
 * `merchant` must stay honest about reach: a merchant-scope access token is
 * accepted by authenticateRequest (src/lib/auth/middleware.ts) and
 * requireMerchant (src/lib/auth/merchant-guard.ts), so it can reach
 * /api/payouts/create (crypto payouts from a business wallet) and
 * /api/banking/transfers as well as the routes that opt in with
 * `allowOAuth`. Do not tell users it cannot move money.
 */
export const SCOPE_INFO: Record<OAuthScope, ScopeInfo> = {
  openid: { label: 'Identity', description: 'Verify your identity', icon: '🔑' },
  profile: { label: 'Profile', description: 'Access your name and profile picture', icon: '👤' },
  email: { label: 'Email', description: 'Access your email address', icon: '📧' },
  did: { label: 'DID', description: 'Access your decentralized identifier', icon: '🆔' },
  'wallet:read': { label: 'Wallet', description: 'View your wallet addresses', icon: '💰' },
  merchant: {
    label: 'Merchant account (full access)',
    description:
      'Act as you on your CoinPay merchant account: create businesses, payments and invoices, ' +
      'add payout addresses, change business settings such as webhooks, and send payouts and ' +
      'transfers from your businesses. Only approve apps you trust with your money.',
    icon: '⚠️',
    sensitive: true,
  },
};

/**
 * Describe a requested scope for the consent screen. A scope with no entry
 * (one added to VALID_SCOPES later without copy) still renders, under its own
 * name, rather than silently disappearing from what the user is approving.
 */
export function describeScope(scope: string): ScopeInfo {
  if (Object.prototype.hasOwnProperty.call(SCOPE_INFO, scope)) {
    return SCOPE_INFO[scope as OAuthScope];
  }
  return {
    label: scope,
    description: `Access granted by the "${scope}" permission`,
    icon: '❔',
  };
}

/**
 * Human-readable scope descriptions for consent screen
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  Object.entries(SCOPE_INFO).map(([scope, info]) => [scope, info.description])
);

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
