/**
 * Exchange Engine types.
 *
 * One quote/order model in front of every swap provider. A provider adapter
 * turns its own API into these shapes; the router, policy gate and order
 * manager only ever see these shapes.
 *
 * Non-custodial by construction: an execution plan always tells the USER'S
 * wallet what to send and where. Nothing here ever holds a key, and no
 * endpoint built on these types accepts one.
 */

/** CoinPay asset symbol, e.g. "BTC", "USDC_BASE". See assets.ts. */
export type ExchangeAsset = string;

export type ExchangeProviderId = 'thorchain' | 'changenow';

export type ExchangeRail = 'crypto_crypto' | 'fiat_crypto' | 'crypto_fiat';

export interface ExchangeQuoteRequest {
  from: ExchangeAsset;
  to: ExchangeAsset;
  /** Decimal string in whole units of `from` (e.g. "0.01" BTC). */
  amount: string;
  /** Where the bought asset goes. Some providers need it to quote. */
  destinationAddress?: string;
  refundAddress?: string;
  /** ISO 3166-1 alpha-2 of the requester, when known. */
  country?: string | null;
}

export interface ExchangeFees {
  /** Fees in units of the destination asset, decimal strings. */
  network?: string;
  liquidity?: string;
  affiliate?: string;
  total?: string;
  /** Total fee in basis points of the trade, when the provider says. */
  totalBps?: number;
}

/** What a provider quotes, normalised. Amounts are decimal strings. */
export interface ExchangeQuote {
  provider: ExchangeProviderId;
  from: ExchangeAsset;
  to: ExchangeAsset;
  amountIn: string;
  /** Expected amount delivered to the destination, after every fee. */
  expectedAmountOut: string;
  fees: ExchangeFees;
  /** Smallest input the provider will accept, whole units of `from`. */
  minAmountIn?: string;
  /** Unix ms. Past this the quote must not be executed. */
  expiresAt: number | null;
  etaSeconds: number | null;
  /** Does the user need to do anything beyond signing a send? */
  verification: 'none' | 'provider_may_require';
  warnings: string[];
  /** Provider route details needed to build the execution plan. */
  route: Record<string, unknown>;
}

/**
 * The next thing the user's wallet must do. The server never does it.
 *
 * - send: an ordinary transfer to a provider deposit address (ChangeNOW).
 * - send_with_memo: a transfer whose memo routes the swap (THORChain). UTXO
 *   chains carry the memo as OP_RETURN; EVM chains go through `router`.
 */
export type ExecutionPlan =
  | {
      kind: 'send';
      chain: ExchangeAsset;
      to: string;
      amount: string;
      extraId?: string;
      expiresAt: number | null;
    }
  | {
      kind: 'send_with_memo';
      chain: ExchangeAsset;
      to: string;
      amount: string;
      memo: string;
      /** EVM only: deposit through this router contract, not a plain send. */
      router?: string;
      expiresAt: number | null;
    };

export interface ProviderOrder {
  providerOrderId: string | null;
  plan: ExecutionPlan;
  /** Redacted, non-secret details worth keeping for support. */
  details: Record<string, unknown>;
}

/** Order lifecycle. See state.ts for the legal transitions. */
export type ExchangeOrderStatus =
  | 'created'
  | 'awaiting_user_action'
  | 'submitted'
  | 'pending'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'refund_pending'
  | 'refunded'
  | 'manual_review';

export interface ProviderStatusUpdate {
  status: ExchangeOrderStatus;
  /** Provider's own status word, kept verbatim for support. */
  providerStatus: string;
  inTxHash?: string;
  outTxHash?: string;
  amountOut?: string;
}

export interface OrderRef {
  providerOrderId: string | null;
  inTxHash: string | null;
  route: Record<string, unknown>;
}

export interface ExchangeAdapter {
  readonly id: ExchangeProviderId;
  readonly label: string;
  isConfigured(): boolean;
  supports(from: ExchangeAsset, to: ExchangeAsset): boolean;
  quote(req: ExchangeQuoteRequest): Promise<ExchangeQuote>;
  /**
   * Turn an accepted quote into something the user's wallet can execute.
   * Implementations re-quote when the provider forbids reusing a quote.
   */
  createOrder(
    quote: ExchangeQuote,
    req: Required<Pick<ExchangeQuoteRequest, 'destinationAddress'>> & ExchangeQuoteRequest
  ): Promise<ProviderOrder>;
  /** Null when there is nothing to poll yet (e.g. no tx hash submitted). */
  getStatus(ref: OrderRef): Promise<ProviderStatusUpdate | null>;
}

export class ExchangeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported'
      | 'policy_denied'
      | 'below_minimum'
      | 'provider_unavailable'
      | 'quote_expired'
      | 'invalid_request'
      | 'invalid_transition',
    readonly status = 400
  ) {
    super(message);
    this.name = 'ExchangeError';
  }
}
