import 'server-only';

/**
 * Plaid as a second finances provider.
 *
 * SimpleFIN is cheap and open but its coverage is community-scale, and linking
 * costs the merchant a trip to the bridge to mint a setup token. Plaid reaches
 * more US institutions than anything else and links inside our own page, which
 * is the whole reason to carry a second provider at all.
 *
 * The adapter's job is to look like SimpleFIN. It returns a `SimpleFinAccountSet`
 * so `sync.ts` keeps one code path: same upsert keys, same categorisation, same
 * idempotence. Everything Plaid-specific — its sign convention, its date format,
 * its pagination — is resolved here and never leaks past this file.
 *
 * Talks to the REST API over `fetch` rather than the `plaid` SDK: the surface we
 * need is four endpoints, and the repo already prefers hand-rolled upstream
 * clients (see `src/lib/swap`, `./simplefin`).
 *
 * Docs: https://plaid.com/docs/api/
 */

import type { SimpleFinAccount, SimpleFinAccountSet, SimpleFinTransaction } from './simplefin';

/** Plaid hosts by environment. `development` was retired; sandbox and production remain. */
const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

/** Max rows `/transactions/get` returns per page. */
const PAGE_SIZE = 500;

/**
 * Stop paging even if Plaid keeps claiming more.
 *
 * 40 pages is 20,000 transactions over a 45-day window — far past anything a
 * real merchant account produces, so hitting it means something is wrong and
 * looping forever would be worse than returning what we have.
 */
const MAX_PAGES = 40;

/**
 * Plaid error codes meaning the merchant must re-link before syncs can resume.
 * Everything else is transient or ours to fix.
 */
const REAUTH_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'ITEM_LOCKED',
  'PENDING_EXPIRATION',
  'USER_PERMISSION_REVOKED',
  'USER_ACCOUNT_REVOKED',
]);

export class PlaidError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    /** True when the fix is a new link, not a retry. */
    readonly requiresRelink = false,
  ) {
    super(message);
    this.name = 'PlaidError';
  }
}

interface PlaidConfig {
  clientId: string;
  secret: string;
  host: string;
  clientName: string;
}

let cachedConfig: PlaidConfig | null = null;

/** Test seam — drops the memoised config so env changes take effect. */
export function resetPlaidConfig(): void {
  cachedConfig = null;
}

/** True when this deployment can offer Plaid at all. */
export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

/**
 * Read credentials from the environment.
 *
 * Throws rather than returning a partial config: a half-configured credential
 * feed into someone's bank should fail at the door, not mid-sync.
 */
function getConfig(): PlaidConfig {
  if (cachedConfig) return cachedConfig;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new PlaidError('Plaid is not configured (PLAID_CLIENT_ID and PLAID_SECRET are required)');
  }

  const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
  const host = PLAID_HOSTS[env];
  if (!host) {
    throw new PlaidError(
      `Unknown PLAID_ENV "${env}" (expected: ${Object.keys(PLAID_HOSTS).join(', ')})`,
    );
  }

  cachedConfig = { clientId, secret, host, clientName: process.env.PLAID_CLIENT_NAME || 'CoinPay' };
  return cachedConfig;
}

interface PlaidErrorBody {
  error_code?: string;
  error_message?: string;
  display_message?: string;
}

/**
 * POST a Plaid endpoint with credentials injected.
 *
 * Credentials travel in the body (Plaid's scheme), so nothing here may be
 * logged: every request carries `secret`, and most carry `access_token` too.
 */
async function plaidPost<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  const config = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, client_id: config.clientId, secret: config.secret }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PlaidError(`Plaid did not respond within ${timeoutMs}ms`);
    }
    throw new PlaidError(`Plaid request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let parsed: PlaidErrorBody = {};
    try {
      parsed = (await response.json()) as PlaidErrorBody;
    } catch {
      // Non-JSON error body; continue with what the status tells us.
    }
    const code = parsed.error_code ?? null;
    throw new PlaidError(
      parsed.display_message || parsed.error_message || `Plaid returned HTTP ${response.status}`,
      code,
      code ? REAUTH_ERROR_CODES.has(code) : false,
    );
  }

  return (await response.json()) as T;
}

/**
 * Format a major-unit number as the decimal string the sync loop expects.
 *
 * `toFixed` rather than `String`: 12.34 arrives as a float that stringifies with
 * trailing noise on some values, and `finance_transactions.amount` is numeric.
 * The `|| 0` collapses `-0` to `0`, which would otherwise store as "-0.00".
 */
function decimalString(value: number): string {
  return (value || 0).toFixed(2);
}

/** ISO `YYYY-MM-DD` in UTC, the only date format Plaid accepts. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Seconds since the epoch, which is how SimpleFIN — and so `sync.ts` — states time. */
function unixSeconds(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
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
    last_updated_datetime?: string | null;
  };
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  name?: string;
  merchant_name?: string | null;
  original_description?: string | null;
  pending?: boolean;
}

/** Plaid types that represent money owed rather than money held. */
const LIABILITY_TYPES = new Set(['credit', 'loan']);

/**
 * Map one account, matching two house conventions that Plaid inverts.
 *
 * A liability's balance is stored NEGATIVE here (`summary.ts` negates it back
 * for display), whereas Plaid states a card balance as a positive amount owed.
 * So credit and loan balances are negated on the way in; depository balances
 * pass through. Getting this backwards makes a card with $500 owing read as
 * $500 of assets, and the net-worth figure moves by twice the balance.
 */
function mapAccount(
  account: PlaidAccount,
  transactions: SimpleFinTransaction[],
  orgName: string | null,
): SimpleFinAccount {
  const balances = account.balances ?? {};
  const liability = LIABILITY_TYPES.has(account.type ?? '');
  const sign = liability ? -1 : 1;

  const mapped: SimpleFinAccount = {
    id: account.account_id,
    name: account.official_name || account.name || 'Account',
    currency: (balances.iso_currency_code || 'USD').toUpperCase(),
    balance:
      typeof balances.current === 'number' ? decimalString(sign * balances.current) : '0.00',
    transactions,
  };

  if (typeof balances.available === 'number') {
    mapped['available-balance'] = decimalString(sign * balances.available);
  }

  const balanceDate = unixSeconds(balances.last_updated_datetime) ?? Math.floor(Date.now() / 1000);
  mapped['balance-date'] = balanceDate;

  if (orgName) mapped.org = { name: orgName };

  return mapped;
}

/**
 * Map one transaction, flipping the sign.
 *
 * Plaid calls money leaving the account POSITIVE. This codebase calls money
 * arriving positive — `summary.ts` sums `amount >= 0` as money in — so the
 * value is negated here. This single line is why an unflipped adapter would
 * report every deposit as spending and every payment as income, silently and
 * with entirely plausible-looking totals.
 */
function mapTransaction(transaction: PlaidTransaction): SimpleFinTransaction {
  const mapped: SimpleFinTransaction = {
    id: transaction.transaction_id,
    posted: unixSeconds(transaction.date) ?? Math.floor(Date.now() / 1000),
    amount: decimalString(-transaction.amount),
    description: transaction.name || transaction.original_description || undefined,
    pending: transaction.pending === true,
  };

  if (transaction.merchant_name) mapped.payee = transaction.merchant_name;

  const transactedAt = unixSeconds(transaction.authorized_date);
  if (transactedAt !== undefined) mapped.transacted_at = transactedAt;

  // Plaid exposes no MCC on this endpoint. Left absent rather than guessed —
  // `categorizeTransaction` falls back to description and payee, which is
  // exactly what it does for SimpleFIN rows that carry no MCC either.
  return mapped;
}

export interface PlaidFetchOptions {
  /** Only transactions posted on or after this instant. */
  startDate?: Date;
  /** Institution name, stored on the connection at link time. */
  orgName?: string | null;
  timeoutMs?: number;
}

/**
 * Pull accounts and transactions, shaped exactly like a SimpleFIN account set.
 *
 * Uses `/transactions/get` rather than `/transactions/sync` deliberately. The
 * finances model is a rolling window with idempotent upserts, and
 * `/transactions/get` is window-based, so it drops straight in — whereas
 * `/transactions/sync` is cursor-based and would need a cursor column plus a
 * second reconciliation path for removals. One endpoint also returns accounts
 * and transactions together, which halves the round trips.
 */
export async function fetchPlaidAccountSet(
  accessToken: string,
  options: PlaidFetchOptions = {},
): Promise<SimpleFinAccountSet> {
  const endDate = new Date();
  const startDate = options.startDate ?? new Date(Date.now() - 45 * 86_400_000);

  const collected: PlaidTransaction[] = [];
  let accounts: PlaidAccount[] = [];
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await plaidPost<{
      accounts: PlaidAccount[];
      transactions: PlaidTransaction[];
      total_transactions: number;
    }>(
      '/transactions/get',
      {
        access_token: accessToken,
        start_date: isoDate(startDate),
        end_date: isoDate(endDate),
        options: { count: PAGE_SIZE, offset: page * PAGE_SIZE },
      },
      options.timeoutMs,
    );

    // Later pages repeat the account list; the first is as good as any.
    if (page === 0) accounts = response.accounts ?? [];
    total = response.total_transactions ?? 0;

    const batch = response.transactions ?? [];
    collected.push(...batch);

    // Stop on a short page as well as on the count: a truthful `total` is not
    // guaranteed, and trusting it alone can spin on an endlessly empty page.
    if (batch.length === 0 || collected.length >= total) break;
  }

  const byAccount = new Map<string, SimpleFinTransaction[]>();
  for (const transaction of collected) {
    const list = byAccount.get(transaction.account_id);
    const mapped = mapTransaction(transaction);
    if (list) list.push(mapped);
    else byAccount.set(transaction.account_id, [mapped]);
  }

  const orgName = options.orgName ?? null;

  return {
    accounts: accounts.map((account) =>
      mapAccount(account, byAccount.get(account.account_id) ?? [], orgName),
    ),
    errors: [],
  };
}

/** Create a short-lived token for Plaid Link, the client-side connect UI. */
export async function createLinkToken(params: {
  /** Stable, non-PII id for the end user. The merchant id. */
  clientUserId: string;
  webhookUrl?: string;
}): Promise<{ linkToken: string; expiresAt: string }> {
  const config = getConfig();
  const response = await plaidPost<{ link_token: string; expiration: string }>(
    '/link/token/create',
    {
      client_name: config.clientName,
      user: { client_user_id: params.clientUserId },
      // `transactions` covers cards too: a credit card arrives as an account of
      // type `credit` on the same item, so no extra product is needed.
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      ...(params.webhookUrl ? { webhook: params.webhookUrl } : {}),
    },
  );

  return { linkToken: response.link_token, expiresAt: response.expiration };
}

export interface PlaidExchange {
  /** Long-lived credential. Store encrypted; never return it over the API. */
  accessToken: string;
  itemId: string;
  institutionName: string | null;
}

/**
 * Swap the client's short-lived public token for a durable access token.
 *
 * The institution lookup is best-effort: it only supplies a display label, and
 * failing it would cost the merchant a link they just completed.
 */
export async function exchangePublicToken(publicToken: string): Promise<PlaidExchange> {
  const exchanged = await plaidPost<{ access_token: string; item_id: string }>(
    '/item/public_token/exchange',
    { public_token: publicToken },
  );

  let institutionName: string | null = null;
  try {
    const item = await plaidPost<{ item: { institution_id?: string | null } }>('/item/get', {
      access_token: exchanged.access_token,
    });
    const institutionId = item.item?.institution_id;
    if (institutionId) {
      const institution = await plaidPost<{ institution: { name?: string } }>(
        '/institutions/get_by_id',
        { institution_id: institutionId, country_codes: ['US'] },
      );
      institutionName = institution.institution?.name ?? null;
    }
  } catch {
    // Keep the connection; it just carries a generic label.
  }

  return {
    accessToken: exchanged.access_token,
    itemId: exchanged.item_id,
    institutionName,
  };
}

/**
 * Revoke an access token upstream.
 *
 * Called before the local row is deleted, so a failure never strands a live
 * credential that still reads a merchant's bank with no way left to reach it.
 */
export async function removePlaidItem(accessToken: string): Promise<void> {
  await plaidPost<Record<string, unknown>>('/item/remove', { access_token: accessToken });
}
