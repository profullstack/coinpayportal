/**
 * Swap Module Type Definitions
 */

/**
 * Supported coins for swaps
 */
export declare const SwapCoins: readonly string[];

/**
 * Swap status values
 */
export declare const SwapStatus: {
  readonly PENDING: 'pending';
  readonly PROCESSING: 'processing';
  readonly SETTLING: 'settling';
  readonly SETTLED: 'settled';
  readonly FAILED: 'failed';
  readonly REFUNDED: 'refunded';
  readonly EXPIRED: 'expired';
};

export type SwapStatusType = (typeof SwapStatus)[keyof typeof SwapStatus];

/**
 * Swap client options
 */
export interface SwapClientOptions {
  /** Wallet ID for tracking swaps */
  walletId?: string;
  /** API base URL */
  baseUrl?: string;
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * Coin information
 */
export interface CoinInfo {
  symbol: string;
  name: string;
  network: string;
  ticker: string;
}

/**
 * Coins list result
 */
export interface CoinsResult {
  success: boolean;
  provider: string;
  coins: CoinInfo[];
  count: number;
}

/**
 * Swap quote
 */
export interface SwapQuote {
  from: string;
  to: string;
  depositAmount: string;
  settleAmount: string;
  rate: string;
  minAmount: number;
  provider: string;
}

/**
 * Quote result
 */
export interface QuoteResult {
  success: boolean;
  quote: SwapQuote;
}

/**
 * Create swap parameters
 */
export interface CreateSwapParams {
  /** Source coin (e.g., 'BTC') */
  from: string;
  /** Destination coin (e.g., 'ETH') */
  to: string;
  /** Amount to swap */
  amount: string | number;
  /** Address to receive swapped coins */
  settleAddress: string;
  /** Address for refunds (recommended) */
  refundAddress?: string;
  /** Override wallet ID */
  walletId?: string;
}

/**
 * Swap details
 */
export interface Swap {
  id: string;
  from: string;
  to: string;
  depositAddress: string;
  depositAmount: string;
  depositCoin?: string;
  settleAddress: string;
  settleAmount?: string;
  settleCoin?: string;
  status: SwapStatusType;
  createdAt: string;
  provider: string;
}

/**
 * Swap result
 */
export interface SwapResult {
  success: boolean;
  swap: Swap;
}

/**
 * Wait for swap options
 */
export interface WaitForSwapOptions {
  /** Polling interval in ms (default: 10000) */
  interval?: number;
  /** Maximum wait time in ms (default: 3600000) */
  timeout?: number;
  /** Statuses to wait for */
  targetStatuses?: SwapStatusType[];
  /** Callback when status changes */
  onStatusChange?: (status: SwapStatusType, swap: Swap) => void;
}

/**
 * Swap history options
 */
export interface SwapHistoryOptions {
  /** Filter by status */
  status?: SwapStatusType;
  /** Number of results (default: 50) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Swap history pagination
 */
export interface SwapHistoryPagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Swap history result
 */
export interface SwapHistoryResult {
  success: boolean;
  swaps: Swap[];
  pagination: SwapHistoryPagination;
}

/**
 * SwapClient class for handling cryptocurrency swaps
 */
export declare class SwapClient {
  /**
   * Create a SwapClient
   */
  constructor(options?: SwapClientOptions);
  
  /**
   * Set the wallet ID for tracking swaps
   */
  setWalletId(walletId: string): void;
  
  /**
   * Get list of supported coins for swaps
   */
  getSwapCoins(options?: { search?: string }): Promise<CoinsResult>;
  
  /**
   * Get a swap quote
   */
  getSwapQuote(from: string, to: string, amount: string | number): Promise<QuoteResult>;
  
  /**
   * Create a swap transaction
   */
  createSwap(params: CreateSwapParams): Promise<SwapResult>;
  
  /**
   * Get the status of a swap
   */
  getSwapStatus(swapId: string): Promise<SwapResult>;
  
  /**
   * Wait for a swap to complete
   */
  waitForSwap(swapId: string, options?: WaitForSwapOptions): Promise<SwapResult>;
  
  /**
   * Get swap history for a wallet
   */
  getSwapHistory(walletId?: string, options?: SwapHistoryOptions): Promise<SwapHistoryResult>;
}

/**
 * Get supported swap coins (convenience function)
 */
export declare function getSwapCoins(options?: {
  baseUrl?: string;
  search?: string;
}): Promise<CoinsResult>;

/**
 * Get a swap quote (convenience function)
 */
export declare function getSwapQuote(
  from: string,
  to: string,
  amount: string | number,
  options?: { baseUrl?: string }
): Promise<QuoteResult>;

/**
 * Create a swap (convenience function)
 */
export declare function createSwap(
  params: CreateSwapParams,
  options?: { baseUrl?: string }
): Promise<SwapResult>;

/**
 * Get swap status (convenience function)
 */
export declare function getSwapStatus(
  swapId: string,
  options?: { baseUrl?: string }
): Promise<SwapResult>;

/**
 * Get swap history (convenience function)
 */
export declare function getSwapHistory(
  walletId: string,
  options?: SwapHistoryOptions & { baseUrl?: string }
): Promise<SwapHistoryResult>;

export default SwapClient;
