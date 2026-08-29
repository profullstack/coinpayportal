/**
 * Plaid adapter — the default US bank & card data provider.
 *
 * Chosen for coverage: Plaid reaches more US institutions than any alternative, which
 * is the only axis that matters for a merchant who must be able to link *their* bank,
 * not a bank from a supported list. Everything Plaid-specific is contained here.
 *
 * Talks to the REST API over `fetch` rather than the `plaid` SDK. The surface we need
 * is five endpoints, the SDK is a large dependency that ships its own axios, and the
 * repo already prefers hand-rolled clients for upstreams (see `src/lib/swap`).
 *
 * Docs: https://plaid.com/docs/api/
 */

import {
  BankDataError,
  type BankAccount,
  type BankAccountType,
  type BankDataProvider,
  type BankTransaction,
} from './types';

/** Plaid hosts by environment. `development` was retired; sandbox and production remain. */
const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

/**
 * Plaid error codes that mean the merchant must re-run Link before syncs can resume.
 * Everything else is either transient or a genuine fault on our side.
 */
const REAUTH_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'ITEM_LOCKED',
  'PENDING_EXPIRATION',
  'USER_PERMISSION_REVOKED',
  'USER_ACCOUNT_REVOKED',
]);

/** Max page size Plaid accepts for `/transactions/sync`. */
const SYNC_PAGE_SIZE = 500;

interface PlaidConfig {
  clientId: string;
  secret: string;
  host: string;
  /** Shown to the end user on Plaid's consent screen. */
  clientName: string;
}

let cachedConfig: PlaidConfig | null = null;

/** Test seam — drops the memoised config so env changes take effect. */
export function resetPlaidClient(): void {
  cachedConfig = null;
}

/**
 * Read Plaid credentials from the environment.
 *
 * Throws rather than returning a partial config: a half-configured money-adjacent
 * integration that fails at request time is worse than one that refuses to start.
 */
function getConfig(): PlaidConfig {
  if (cachedConfig) return cachedConfig;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new BankDataError(
      'Plaid is not configured (PLAID_CLIENT_ID and PLAID_SECRET are required)',
      'plaid',
    );
  }

  const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
  const host = PLAID_HOSTS[env];
  if (!host) {
    throw new BankDataError(
      `Unknown PLAID_ENV "${env}" (expected: ${Object.keys(PLAID_HOSTS).join(', ')})`,
      'plaid',
    );
  }

  cachedConfig = {
    clientId,
    secret,
    host,
    clientName: process.env.PLAID_CLIENT_NAME || 'CoinPay',
  };
  return cachedConfig;
}

interface PlaidErrorBody {
  error_code?: string;
  error_message?: string;
  display_message?: string;
}

/**
 * POST a Plaid endpoint, injecting credentials.
 *
 * Credentials go in the body (Plaid's scheme), which is why nothing here may be
 * logged: the request body carries `secret` and, on most calls, `access_token`.
 */
async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const config = getConfig();

  let response: Response;
  try {
    response = await fetch(`${config.host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, client_id: config.clientId, secret: config.secret }),
    });
  } catch (error) {
    // Network-level failure: no response at all, so there is no Plaid error code.
    throw new BankDataError(
      `Plaid request failed: ${error instanceof Error ? error.message : String(error)}`,
      'plaid',
    );
  }

  if (!response.ok) {
    let parsed: PlaidErrorBody = {};
    try {
      parsed = (await response.json()) as PlaidErrorBody;
    } catch {
      // Plaid returned a non-JSON error body; fall through with what we know.
    }
    const code = parsed.error_code ?? null;
    throw new BankDataError(
      parsed.display_message ||
        parsed.error_message ||
        `Plaid returned HTTP ${response.status}`,
      'plaid',
      code,
      code ? REAUTH_ERROR_CODES.has(code) : false,
    );
  }

  return (await response.json()) as T;
}

/**
 * Convert a provider's major-unit JSON number to signed minor units.
 *
 * `Math.round` after scaling is the point: 12.34 arrives as a float that is not
 * exactly 12.34, and truncation would lose a cent on a large fraction of rows.
 */
function toMinorUnits(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new BankDataError(`Plaid returned a non-numeric amount: ${amount}`, 'plaid');
  }
  return Math.round(amount * 100);
}

/** Plaid account types map almost 1:1; anything unrecognised degrades to 'other'. */
function toAccountType(raw: string | undefined): BankAccountType {
  switch (raw) {
    case 'depository':
    case 'credit':
    case 'loan':
    case 'investment':
      return raw;
    default:
      return 'other';
  }
}

interface PlaidAccount {
  account_id: string;
  name?: string;
  official_name?: string | null;
  mask?: string | null;
  type?: string;
  subtype?: string | null;
  balances?: {
    current?: number | null;
    available?: number | null;
    iso_currency_code?: string | null;
  };
}

function mapAccount(account: PlaidAccount): BankAccount {
  const balances = account.balances ?? {};
  return {
    providerAccountId: account.account_id,
    name: account.official_name || account.name || 'Account',
    mask: account.mask ?? null,
    type: toAccountType(account.type),
    subtype: account.subtype ?? null,
    currentBalanceMinor:
      typeof balances.current === 'number' ? toMinorUnits(balances.current) : null,
    availableBalanceMinor:
      typeof balances.available === 'number' ? toMinorUnits(balances.available) : null,
    currency: (balances.iso_currency_code || 'USD').toUpperCase(),
  };
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  name?: string;
  merchant_name?: string | null;
  pending?: boolean;
  personal_finance_category?: { primary?: string } | null;
  category?: string[] | null;
}

/**
 * Map a Plaid transaction, flipping the sign.
 *
 * Plaid's convention is that a POSITIVE amount means money moving OUT of the account.
 * Ours is the opposite — positive means a deposit — because reconciliation searches for
 * incoming settlements and reads far better that way. This negation is the single
 * point where the two conventions meet; if it is ever removed, every reconciliation
 * silently returns zero matches rather than failing loudly.
 */
function mapTransaction(transaction: PlaidTransaction): BankTransaction {
  return {
    providerTransactionId: transaction.transaction_id,
    providerAccountId: transaction.account_id,
    amountMinor: -toMinorUnits(transaction.amount),
    currency: (transaction.iso_currency_code || 'USD').toUpperCase(),
    date: transaction.date,
    description: transaction.name || '',
    counterparty: transaction.merchant_name ?? null,
    pending: transaction.pending === true,
    category:
      transaction.personal_finance_category?.primary ?? transaction.category?.[0] ?? null,
  };
}

export const plaidProvider: BankDataProvider = {
  name: 'plaid',

  async createLinkSession({ clientUserId, webhookUrl }) {
    const config = getConfig();
    const response = await plaidPost<{ link_token: string; expiration: string }>(
      '/link/token/create',
      {
        client_name: config.clientName,
        user: { client_user_id: clientUserId },
        // `transactions` covers both bank and credit-card activity; cards arrive as
        // accounts of type `credit` on the same item, so no extra product is needed.
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
        ...(webhookUrl ? { webhook: webhookUrl } : {}),
      },
    );

    return { linkToken: response.link_token, expiresAt: response.expiration };
  },

  async exchangePublicToken(publicToken) {
    const exchanged = await plaidPost<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: publicToken },
    );

    // Institution metadata is presentation-only, so a failure here must not cost the
    // merchant a completed link — degrade to an unnamed connection instead.
    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      const item = await plaidPost<{ item: { institution_id?: string | null } }>('/item/get', {
        access_token: exchanged.access_token,
      });
      institutionId = item.item?.institution_id ?? null;

      if (institutionId) {
        const institution = await plaidPost<{ institution: { name?: string } }>(
          '/institutions/get_by_id',
          { institution_id: institutionId, country_codes: ['US'] },
        );
        institutionName = institution.institution?.name ?? null;
      }
    } catch {
      // Keep the connection; the dashboard falls back to a generic label.
    }

    return {
      accessToken: exchanged.access_token,
      providerItemId: exchanged.item_id,
      institutionId,
      institutionName,
    };
  },

  async listAccounts(accessToken) {
    const response = await plaidPost<{ accounts: PlaidAccount[] }>('/accounts/get', {
      access_token: accessToken,
    });
    return (response.accounts ?? []).map(mapAccount);
  },

  async syncTransactions(accessToken, cursor) {
    const response = await plaidPost<{
      added: PlaidTransaction[];
      modified: PlaidTransaction[];
      removed: Array<{ transaction_id: string }>;
      next_cursor: string;
      has_more: boolean;
    }>('/transactions/sync', {
      access_token: accessToken,
      // Plaid rejects an explicit null cursor; omitting it means "from the beginning".
      ...(cursor ? { cursor } : {}),
      count: SYNC_PAGE_SIZE,
    });

    return {
      added: (response.added ?? []).map(mapTransaction),
      modified: (response.modified ?? []).map(mapTransaction),
      removedIds: (response.removed ?? []).map((entry) => entry.transaction_id),
      nextCursor: response.next_cursor,
      hasMore: response.has_more === true,
    };
  },

  async removeConnection(accessToken) {
    await plaidPost<Record<string, unknown>>('/item/remove', { access_token: accessToken });
  },
};
