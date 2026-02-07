/**
 * Swap Module for CoinPay SDK
 * 
 * Provides cryptocurrency swap functionality using ChangeNow v2 API.
 * Swaps are non-custodial and work in the USA (no KYC required).
 */

const DEFAULT_BASE_URL = 'https://coinpayportal.com/api';

/**
 * Supported coins for swaps
 */
export const SwapCoins = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL',
  'BNB', 'DOGE', 'XRP', 'ADA',
  'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
  'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL',
];

/**
 * Swap status mapping
 */
export const SwapStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SETTLING: 'settling',
  SETTLED: 'settled',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  EXPIRED: 'expired',
};

/**
 * SwapClient - Handles cryptocurrency swaps
 */
export class SwapClient {
  #baseUrl;
  #timeout;
  #walletId;
  
  /**
   * Create a SwapClient
   * @param {Object} options - Client options
   * @param {string} [options.walletId] - Wallet ID for tracking swaps
   * @param {string} [options.baseUrl] - API base URL
   * @param {number} [options.timeout] - Request timeout in ms
   */
  constructor(options = {}) {
    this.#baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.#timeout = options.timeout || 30000;
    this.#walletId = options.walletId || null;
  }
  
  /**
   * Set the wallet ID for tracking swaps
   * @param {string} walletId - Wallet ID
   */
  setWalletId(walletId) {
    this.#walletId = walletId;
  }
  
  /**
   * Make an API request
   * @private
   */
  async #request(endpoint, options = {}) {
    const url = `${this.#baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.#timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.response = data;
        throw error;
      }
      
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.#timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Get list of supported coins for swaps
   * @param {Object} [options] - Query options
   * @param {string} [options.search] - Search/filter coins by name or symbol
   * @returns {Promise<Object>} List of supported coins
   */
  async getSwapCoins(options = {}) {
    const result = await this.#request('/swap/coins');
    
    if (options.search) {
      const search = options.search.toLowerCase();
      result.coins = result.coins.filter(coin =>
        coin.symbol.toLowerCase().includes(search) ||
        coin.name.toLowerCase().includes(search)
      );
    }
    
    return result;
  }
  
  /**
   * Get a swap quote
   * @param {string} from - Source coin (e.g., 'BTC')
   * @param {string} to - Destination coin (e.g., 'ETH')
   * @param {string|number} amount - Amount to swap
   * @returns {Promise<Object>} Swap quote with rates and estimates
   */
  async getSwapQuote(from, to, amount) {
    if (!from || !to || !amount) {
      throw new Error('from, to, and amount are required');
    }
    
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    
    if (!SwapCoins.includes(fromUpper)) {
      throw new Error(`Unsupported source coin: ${fromUpper}. Supported: ${SwapCoins.join(', ')}`);
    }
    
    if (!SwapCoins.includes(toUpper)) {
      throw new Error(`Unsupported destination coin: ${toUpper}. Supported: ${SwapCoins.join(', ')}`);
    }
    
    if (fromUpper === toUpper) {
      throw new Error('Cannot swap a coin for itself');
    }
    
    const params = new URLSearchParams({
      from: fromUpper,
      to: toUpper,
      amount: String(amount),
    });
    
    return this.#request(`/swap/quote?${params}`);
  }
  
  /**
   * Create a swap transaction
   * @param {Object} params - Swap parameters
   * @param {string} params.from - Source coin
   * @param {string} params.to - Destination coin
   * @param {string|number} params.amount - Amount to swap
   * @param {string} params.settleAddress - Address to receive swapped coins
   * @param {string} [params.refundAddress] - Address for refunds (recommended)
   * @param {string} [params.walletId] - Override wallet ID for this swap
   * @returns {Promise<Object>} Swap transaction with deposit address
   */
  async createSwap(params) {
    const { from, to, amount, settleAddress, refundAddress, walletId } = params;
    
    if (!from || !to || !amount || !settleAddress) {
      throw new Error('from, to, amount, and settleAddress are required');
    }
    
    const effectiveWalletId = walletId || this.#walletId;
    if (!effectiveWalletId) {
      throw new Error('walletId is required. Set it in constructor or pass it in params.');
    }
    
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    
    if (!SwapCoins.includes(fromUpper)) {
      throw new Error(`Unsupported source coin: ${fromUpper}`);
    }
    
    if (!SwapCoins.includes(toUpper)) {
      throw new Error(`Unsupported destination coin: ${toUpper}`);
    }
    
    if (fromUpper === toUpper) {
      throw new Error('Cannot swap a coin for itself');
    }
    
    return this.#request('/swap/create', {
      method: 'POST',
      body: JSON.stringify({
        from: fromUpper,
        to: toUpper,
        amount: String(amount),
        settleAddress,
        refundAddress,
        walletId: effectiveWalletId,
      }),
    });
  }
  
  /**
   * Get the status of a swap
   * @param {string} swapId - Swap transaction ID
   * @returns {Promise<Object>} Swap status and details
   */
  async getSwapStatus(swapId) {
    if (!swapId) {
      throw new Error('swapId is required');
    }
    
    return this.#request(`/swap/${swapId}`);
  }
  
  /**
   * Wait for a swap to complete
   * @param {string} swapId - Swap transaction ID
   * @param {Object} [options] - Polling options
   * @param {number} [options.interval=10000] - Polling interval in ms
   * @param {number} [options.timeout=3600000] - Maximum wait time in ms (default: 1 hour)
   * @param {string[]} [options.targetStatuses] - Statuses to wait for
   * @param {Function} [options.onStatusChange] - Callback when status changes
   * @returns {Promise<Object>} Final swap status
   */
  async waitForSwap(swapId, options = {}) {
    const {
      interval = 10000,
      timeout = 3600000,
      targetStatuses = [SwapStatus.SETTLED, SwapStatus.FAILED, SwapStatus.REFUNDED, SwapStatus.EXPIRED],
      onStatusChange,
    } = options;
    
    const startTime = Date.now();
    let lastStatus = null;
    
    while (Date.now() - startTime < timeout) {
      const result = await this.getSwapStatus(swapId);
      const currentStatus = result.swap?.status;
      
      // Notify on status change
      if (currentStatus !== lastStatus) {
        if (onStatusChange && lastStatus !== null) {
          onStatusChange(currentStatus, result.swap);
        }
        lastStatus = currentStatus;
      }
      
      // Check if we've reached a target status
      if (targetStatuses.includes(currentStatus)) {
        return result;
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error(`Swap status check timed out after ${timeout}ms`);
  }
  
  /**
   * Get swap history for a wallet
   * @param {string} [walletId] - Wallet ID (uses default if not provided)
   * @param {Object} [options] - Query options
   * @param {string} [options.status] - Filter by status
   * @param {number} [options.limit=50] - Number of results
   * @param {number} [options.offset=0] - Pagination offset
   * @returns {Promise<Object>} Swap history
   */
  async getSwapHistory(walletId, options = {}) {
    const effectiveWalletId = walletId || this.#walletId;
    if (!effectiveWalletId) {
      throw new Error('walletId is required');
    }
    
    const params = new URLSearchParams({
      walletId: effectiveWalletId,
    });
    
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    
    return this.#request(`/swap/history?${params}`);
  }
}

// Convenience functions for one-off operations

/**
 * Get supported swap coins
 * @param {Object} [options] - Options
 * @param {string} [options.baseUrl] - API base URL
 * @param {string} [options.search] - Search filter
 * @returns {Promise<Object>} Supported coins
 */
export async function getSwapCoins(options = {}) {
  const client = new SwapClient({ baseUrl: options.baseUrl });
  return client.getSwapCoins(options);
}

/**
 * Get a swap quote
 * @param {string} from - Source coin
 * @param {string} to - Destination coin
 * @param {string|number} amount - Amount
 * @param {Object} [options] - Options
 * @param {string} [options.baseUrl] - API base URL
 * @returns {Promise<Object>} Quote
 */
export async function getSwapQuote(from, to, amount, options = {}) {
  const client = new SwapClient({ baseUrl: options.baseUrl });
  return client.getSwapQuote(from, to, amount);
}

/**
 * Create a swap
 * @param {Object} params - Swap parameters
 * @param {Object} [options] - Options
 * @param {string} [options.baseUrl] - API base URL
 * @returns {Promise<Object>} Swap details
 */
export async function createSwap(params, options = {}) {
  const client = new SwapClient({ 
    baseUrl: options.baseUrl,
    walletId: params.walletId,
  });
  return client.createSwap(params);
}

/**
 * Get swap status
 * @param {string} swapId - Swap ID
 * @param {Object} [options] - Options
 * @param {string} [options.baseUrl] - API base URL
 * @returns {Promise<Object>} Swap status
 */
export async function getSwapStatus(swapId, options = {}) {
  const client = new SwapClient({ baseUrl: options.baseUrl });
  return client.getSwapStatus(swapId);
}

/**
 * Get swap history
 * @param {string} walletId - Wallet ID
 * @param {Object} [options] - Query options
 * @param {string} [options.baseUrl] - API base URL
 * @returns {Promise<Object>} Swap history
 */
export async function getSwapHistory(walletId, options = {}) {
  const client = new SwapClient({ baseUrl: options.baseUrl });
  return client.getSwapHistory(walletId, options);
}

export default SwapClient;
