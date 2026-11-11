/**
 * OAuth2/OIDC Scope definitions and utilities
 */

export const VALID_SCOPES = ['openid', 'profile', 'email', 'did', 'wallet:read', 'merchant', 'invoices'] as const;

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
 * `merchant` must stay honest about reach. A merchant-scope access token acts
 * as the user on the merchant API (businesses, payments, invoices, payout
 * addresses, webhooks) but cannot move funds: payouts (/api/payouts/create),
 * bank transfers and linked bank accounts (/api/banking), custom payout
 * addresses on payments and invoices (`funds.move` in authorizeBusiness), pay
 * runs, and business API keys (which can send payouts) are all refused with
 * `oauth_cannot_move_funds`; see src/lib/auth/oauth-funds.ts. It CAN add
 * payout addresses to a business (onboarding needs it), and those receive
 * future payments, so the entry stays flagged.
 */
export const SCOPE_INFO: Record<OAuthScope, ScopeInfo> = {
  openid: { label: 'Identity', description: 'Verify your identity', icon: '🔑' },
  profile: { label: 'Profile', description: 'Access your name, profile picture, and linked OpenProfile.md URL', icon: '👤' },
  email: { label: 'Email', description: 'Access your email address', icon: '📧' },
  did: { label: 'DID', description: 'Access your decentralized identifier', icon: '🆔' },
  'wallet:read': { label: 'Wallet', description: 'View your wallet addresses', icon: '💰' },
  merchant: {
    label: 'Merchant account',
    description:
      'Act as you on your CoinPay merchant account: create businesses, payments and invoices, ' +
      'add payout addresses, and change business settings such as webhooks. Payout addresses it ' +
      'adds receive future payments, so only approve apps you trust. It cannot send payouts, ' +
      'transfers or withdrawals.',
    icon: '⚠️',
    sensitive: true,
  },
  // The remote MCP server (/api/mcp) and nothing else accepts this scope; the
  // merchant API still requires `merchant`. See src/lib/mcp/.
  invoices: {
    label: 'Invoices and projects',
    description:
      'Read your invoices, projects, contractors, pay runs and document status, create DRAFT invoices ' +
      'and log time. It cannot send an invoice, email anyone, approve work, pay a pay run or move funds.',
    icon: '🧾',
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
