/**
 * Provider-neutral bank & card data types.
 *
 * CoinPay reads merchant bank and credit-card activity so that fiat settlements can be
 * reconciled against what the platform believes it paid out. The data provider sits
 * behind an interface deliberately: Plaid has the widest US institution coverage and is
 * the default, but the on-ramp lesson applies here too — never be single-vendor on a
 * rail a merchant depends on.
 *
 * Two normalisations happen at the adapter boundary, and both matter:
 *
 *  1. **Amounts are signed minor units** (cents), never floats. Providers quote major
 *     units as JSON numbers; float drift in money code is not acceptable here.
 *  2. **Sign convention is `positive = money INTO the account`** (a credit/deposit).
 *     Plaid uses the opposite convention, so its adapter flips. Reconciliation only
 *     ever looks for credits, so getting this backwards silently matches nothing.
 */

/** Which upstream provided a connection. Persisted, so values are stable strings. */
export type BankDataProviderName = 'plaid';

/** Lifecycle of a linked institution. Mirrors what the dashboard shows a merchant. */
export type BankConnectionStatus =
  /** Healthy; syncs are running. */
  | 'active'
  /** Credentials/MFA expired — the merchant must re-authenticate before syncs resume. */
  | 'reauth_required'
  /** Merchant (or an admin) disconnected it. Terminal. */
  | 'disconnected'
  /** Provider reported an error we cannot resolve by retrying. */
  | 'error';

export type BankAccountType = 'depository' | 'credit' | 'loan' | 'investment' | 'other';

/** A single account inside a linked institution. */
export interface BankAccount {
  /** Provider's stable id for the account. Unique within a connection. */
  providerAccountId: string;
  name: string;
  /** Last 2-4 digits, when the provider exposes them. */
  mask: string | null;
  type: BankAccountType;
  /** Provider-specific refinement, e.g. 'checking', 'savings', 'credit card'. */
  subtype: string | null;
  /** Current balance in signed minor units, or null when the provider omits it. */
  currentBalanceMinor: number | null;
  /** Available balance in signed minor units, or null. */
  availableBalanceMinor: number | null;
  /** ISO-4217, upper case. Defaults to USD when the provider omits it. */
  currency: string;
}

/** One posted or pending transaction, normalised. */
export interface BankTransaction {
  /** Provider's stable id. Used as the upsert key, so it must not be synthesised. */
  providerTransactionId: string;
  providerAccountId: string;
  /**
   * Signed minor units. POSITIVE = money into the account (deposit/credit);
   * NEGATIVE = money out (payment/debit).
   */
  amountMinor: number;
  currency: string;
  /** Post date, ISO `YYYY-MM-DD`. */
  date: string;
  /** Description as the institution reports it. */
  description: string;
  /** Cleaned-up counterparty name when the provider enriches it. */
  counterparty: string | null;
  /** Pending transactions can change id and amount; never reconcile against them. */
  pending: boolean;
  /** Provider category label, flattened to a single string for display. */
  category: string | null;
}

/** Incremental sync result. Cursor-based so we never re-pull the full history. */
export interface BankTransactionSync {
  added: BankTransaction[];
  modified: BankTransaction[];
  /** Provider transaction ids that no longer exist and must be deleted locally. */
  removedIds: string[];
  /** Opaque cursor to persist and pass to the next call. */
  nextCursor: string;
  /** True when more pages remain; callers should loop until false. */
  hasMore: boolean;
}

/** Everything needed to render the provider's link UI on the client. */
export interface LinkSession {
  /** Short-lived token handed to the provider's front-end SDK. */
  linkToken: string;
  expiresAt: string;
}

/** Result of exchanging the client-side public token for durable credentials. */
export interface LinkExchange {
  /**
   * Long-lived credential. NEVER log this, never return it over the API, and only
   * persist it encrypted — it grants ongoing read access to the merchant's accounts.
   */
  accessToken: string;
  /** Provider's id for the linked institution instance. */
  providerItemId: string;
  institutionId: string | null;
  institutionName: string | null;
}

/**
 * The contract every bank-data provider implements.
 *
 * Adapters own their HTTP and their quirks; everything above this line is
 * provider-neutral. Adding a second provider must not require touching callers.
 */
export interface BankDataProvider {
  readonly name: BankDataProviderName;

  /** Create a short-lived session for the client-side link flow. */
  createLinkSession(params: {
    /** Stable, non-PII id for the end user. We pass the merchant id. */
    clientUserId: string;
    /** Where the provider should POST connection lifecycle events. */
    webhookUrl?: string;
  }): Promise<LinkSession>;

  /** Exchange the client's short-lived public token for durable credentials. */
  exchangePublicToken(publicToken: string): Promise<LinkExchange>;

  listAccounts(accessToken: string): Promise<BankAccount[]>;

  /** Pull one page of changes. Pass `null` on the very first sync. */
  syncTransactions(accessToken: string, cursor: string | null): Promise<BankTransactionSync>;

  /** Revoke the credential upstream. Must be called before deleting local rows. */
  removeConnection(accessToken: string): Promise<void>;
}

/** Raised for provider faults so routes can distinguish them from bugs. */
export class BankDataError extends Error {
  constructor(
    message: string,
    readonly provider: BankDataProviderName,
    /** Provider's own error code, when it supplies one. */
    readonly providerCode: string | null = null,
    /** True when the merchant must re-run the link flow to fix it. */
    readonly requiresReauth = false,
  ) {
    super(message);
    this.name = 'BankDataError';
  }
}
