import type { CoinPayClient } from './client.js';

export type AccountKind = 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other' | string;

export interface FinanceAccount {
  id: string;
  connection_id: string;
  external_id: string;
  org_name: string | null;
  org_domain: string | null;
  name: string;
  currency: string;
  balance: number | null;
  available_balance: number | null;
  balance_date: string | null;
  kind: AccountKind;
  kind_override: string | null;
  /** Operator correction for which side of the books, or null for the guess. */
  scope_override: string | null;
  is_hidden: boolean;
  last_seen_at: string;
  effective_kind: AccountKind;
  is_liability: boolean;
  display_balance: number | null;
  /** `scope_override` when set, otherwise derived from the account name. */
  effective_scope: AccountScope;
}

export interface FinanceTransaction {
  id: string;
  account_id: string;
  posted: string;
  transacted_at: string | null;
  amount: number;
  description: string | null;
  payee: string | null;
  memo: string | null;
  mcc: string | null;
  pending: boolean;
  category: string | null;
  account_name: string;
  org_name: string | null;
  currency: string;
}

export interface FinanceTransactionPage {
  rows: FinanceTransaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface FinanceConnection {
  id: string;
  provider: 'simplefin' | 'plaid' | string;
  label: string | null;
  is_active: boolean;
  created_at: string;
  last_synced_at: string | null;
  last_sync_status: 'ok' | 'partial' | 'error' | string | null;
  last_sync_error: string | null;
  last_sync_accounts: number | null;
  last_sync_transactions: number | null;
  /** SimpleFIN protocol shape pinned on the credential; null = tested default. */
  protocol_version?: 1 | 2 | null;
  /** When the merchant opted into a once-daily background sync; null = never. */
  sync_consent_at?: string | null;
  next_sync_at?: string | null;
  lifecycle_state?: 'active' | 'reconnect_required' | 'payment_required' | 'disconnected' | string;
  disconnected_at?: string | null;
}

/** Every transaction in a window, paged until exhausted or `max` is hit. */
export function listAllFinanceTransactions(
  client: CoinPayClient,
  options?: { startDate?: string | Date; endDate?: string | Date; pageSize?: number; max?: number },
): Promise<{ rows: FinanceTransaction[]; total: number; complete: boolean }>;

export interface FinanceSummary {
  windowDays: number;
  totals: Array<{ currency: string; assets: number; liabilities: number; net: number; accounts: number }>;
  primaryCurrency: string | null;
  byKind: Array<{ kind: AccountKind; currency: string; total: number; accounts: number }>;
  byInstitution: Array<{ org: string; currency: string; assets: number; liabilities: number; accounts: number }>;
  cashflow: { currency: string | null; moneyIn: number; moneyOut: number; net: number; transactions: number };
  topCategories: Array<{ category: string | null; spent: number; received: number; count: number }>;
  accountCount: number;
  hiddenCount: number;
  transactionCount: number;
  oldestTransaction: string | null;
  newestTransaction: string | null;
  /** Debt against income, over a longer window than `windowDays`. */
  position: FinancePosition;
}

export interface FinanceSeriesPoint {
  label: string;
  volumeUsd: number;
  cryptoUsd: number;
  cardUsd: number;
  commissionUsd: number;
  count: number;
}

export type AccountScope = 'business' | 'personal';

export interface UpdateFinanceAccountInput {
  /** Corrected account kind, or null to use the derived guess. */
  kind?: string | null;
  /** Which side of the books, or null to use the name-derived guess. */
  scope?: AccountScope | null;
  /** Drop a closed or duplicate account out of the totals. */
  hidden?: boolean;
}

export function updateFinanceAccount(
  client: CoinPayClient,
  accountId: string,
  input: UpdateFinanceAccountInput,
): Promise<FinanceAccount>;
export type RecurrenceCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';

/**
 * Debt against income for a linked feed. Computed server-side over roughly
 * six months, so it does not move with the dashboard window.
 *
 * Transfers and card payments are excluded from both `income` and `spending`:
 * a feed holding both a checking account and the card it pays would otherwise
 * count every card payment on both sides. The untouched totals are kept as
 * `grossCredits` / `grossDebits` so the netting is auditable.
 */
export interface FinancePosition {
  currency: string | null;
  /** Days of history that were asked for. */
  lookbackDays: number;
  /** Days of history that exist, capped at `lookbackDays`. Divides the averages. */
  observedDays: number;
  monthsObserved: number;
  months: Array<{
    month: string;
    income: number;
    spending: number;
    net: number;
    debtService: number;
    transactions: number;
    partial: boolean;
  }>;
  income: { total: number; perMonth: number; grossCredits: number; transactions: number };
  spending: { total: number; perMonth: number; grossDebits: number; refunds: number; transactions: number };
  net: { total: number; perMonth: number; savingsRate: number | null };
  debt: {
    total: number;
    revolving: number;
    instalment: number;
    accounts: Array<{
      id: string;
      name: string;
      org: string | null;
      kind: string;
      scope: AccountScope;
      owed: number;
      share: number;
      paid: number;
      payoffMonths: number | null;
    }>;
    servicePerMonth: number;
    payoffMonths: number | null;
    payoffDate: string | null;
  };
  ratios: {
    debtToIncome: number | null;
    debtServiceRatio: number | null;
    monthsOfCover: number | null;
    creditUtilisation: number | null;
  };
  recurring: {
    charges: Array<{
      payee: string;
      amount: number;
      cadence: RecurrenceCadence;
      occurrences: number;
      lastSeen: string;
      nextExpected: string;
      monthlyEquivalent: number;
      scope: AccountScope;
      isDebtService: boolean;
    }>;
    monthlyTotal: number;
    monthlyDebtService: number;
  };
  scopes: Array<{
    scope: AccountScope;
    accounts: number;
    assets: number;
    debt: number;
    income: number;
    spending: number;
    net: number;
  }>;
  confidence: { uncategorisedShare: number; transactions: number; noLiabilityAccounts: boolean };
}

export interface FinanceSnapshot {
  generatedAt: string;
  windowDays: number;
  plan: { id: string; commission_rate: number; commission_percent: string } | null;
  businesses: Array<{ id: string; name: string }>;
  earnings: {
    grossVolumeUsd: number;
    cryptoVolumeUsd: number;
    cardVolumeUsd: number;
    commissionUsd: number;
    stripeFeesUsd: number;
    refundsUsd: number;
    netUsd: number;
    transactions: number;
    failed: number;
    failureRate: number;
  };
  series: FinanceSeriesPoint[];
  crypto: {
    volumeUsd: number;
    feesUsd: number;
    successful: number;
    failed: number;
    pending: number;
    total: number;
    byChain: Record<string, number>;
    partial: boolean;
  };
  card: {
    volumeUsd: number;
    platformFeesUsd: number;
    stripeFeesUsd: number;
    netUsd: number;
    refundedUsd: number;
    successful: number;
    failed: number;
    refunded: number;
    total: number;
    partial: boolean;
  };
  escrow: {
    heldUsd: number;
    held: number;
    releasedUsd: number;
    released: number;
    refundedUsd: number;
    refunded: number;
    feesUsd: number;
    total: number;
  };
  invoices: {
    totals: Record<'draft' | 'outstanding' | 'overdue' | 'paid' | 'cancelled', number>;
    counts: Record<'draft' | 'outstanding' | 'overdue' | 'paid' | 'cancelled', number>;
    rows: Array<Record<string, unknown>>;
  };
  payout: { paidUsd: number; pendingUsd: number; count: number };
  bank: {
    currency: string;
    assets: number;
    liabilities: number;
    net: number;
    accountCount: number;
    hiddenCount: number;
    transactionCount: number;
    cashflow: { moneyIn: number; moneyOut: number; net: number; transactions: number };
    byKind: FinanceSummary['byKind'];
    byInstitution: FinanceSummary['byInstitution'];
    topCategories: FinanceSummary['topCategories'];
    newestTransaction: string | null;
    accounts: FinanceAccount[];
    creditCards: FinanceAccount[];
    connections: FinanceConnection[];
    plaidEnabled: boolean;
    ledger: FinanceTransaction[];
    ledgerTotal: number;
  };
  /** Null when the summary source failed; the screen says so rather than showing zeros. */
  position: FinancePosition | null;
  recent: {
    payments: Array<Record<string, unknown>>;
    cards: Array<Record<string, unknown>>;
    escrows: Array<Record<string, unknown>>;
  };
  errors: Record<string, string>;
}

export interface FinanceSnapshotOptions {
  /** Window in days for cashflow, earnings and the daily series. Default 30. */
  days?: number;
  /** Rows per list (payments, card charges, ledger). Default 100. */
  limit?: number;
  /** Narrow payments and analytics to one business. */
  businessId?: string;
}

export type PaymentStreamEvent =
  | { type: 'connected' | 'heartbeat'; timestamp: string }
  | {
      type: 'payment_created' | 'payment_updated' | 'payment_completed' | 'payment_expired';
      timestamp: string;
      payment: {
        id: string;
        status: string;
        amount_crypto: string;
        amount_usd: string;
        currency: string;
        payment_address: string;
        confirmations?: number;
        required_confirmations?: number;
        tx_hash?: string;
        created_at: string;
        updated_at: string;
      };
    };

export type PaymentStreamStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'closed';

export function periodForDays(days: number): '7d' | '30d' | '90d' | '1y' | 'all';
export function cryptoFeeUsd(payment: Record<string, unknown>): number;

export function getFinanceSummary(client: CoinPayClient, options?: { days?: number; includeHidden?: boolean }): Promise<FinanceSummary>;
export function listFinanceAccounts(client: CoinPayClient, options?: { includeHidden?: boolean }): Promise<FinanceAccount[]>;
export function listFinanceTransactions(
  client: CoinPayClient,
  filters?: {
    accountId?: string;
    search?: string;
    category?: string;
    startDate?: string;
    endDate?: string;
    includePending?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<FinanceTransactionPage>;
export function listFinanceConnections(client: CoinPayClient): Promise<{ connections: FinanceConnection[]; plaidEnabled: boolean }>;
export function syncFinances(client: CoinPayClient, options?: { days?: number; connectionId?: string }): Promise<{
  results: Array<Record<string, unknown>>;
  totals: { accounts: number; transactionsSeen: number; transactionsNew: number };
  status: 'ok' | 'partial';
}>;
export function getDashboardStats(client: CoinPayClient, options?: { businessId?: string }): Promise<Record<string, unknown>>;
export function getFinanceAnalytics(client: CoinPayClient, options?: { period?: string; businessId?: string }): Promise<Record<string, unknown>>;
export function listCryptoPayments(
  client: CoinPayClient,
  options?: { limit?: number; offset?: number; status?: string; businessId?: string; dateFrom?: string; dateTo?: string },
): Promise<Record<string, unknown>>;
export function listCardTransactions(
  client: CoinPayClient,
  options?: { limit?: number; offset?: number; status?: string; businessId?: string; dateFrom?: string; dateTo?: string },
): Promise<Record<string, unknown>>;
export function listCardPayouts(client: CoinPayClient, options?: { limit?: number; offset?: number; status?: string }): Promise<Record<string, unknown>>;

export function buildFinanceSnapshot(raw?: Record<string, unknown>, options?: { days?: number; now?: Date }): FinanceSnapshot;
export function collectFinanceSnapshot(client: CoinPayClient, options?: FinanceSnapshotOptions): Promise<FinanceSnapshot>;

export function subscribeToPayments(options: {
  baseUrl: string;
  token: string;
  businessId?: string;
  onEvent?: (event: PaymentStreamEvent) => void;
  onStatus?: (status: PaymentStreamStatus, detail?: string) => void;
}): () => void;
