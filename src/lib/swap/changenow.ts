/**
 * ChangeNOW API client for no-KYC coin swaps
 * Works in USA! 🇺🇸
 * Docs: https://changenow.io/api/docs
 */

import {
  SwapQuoteParams,
  SwapCreateParams,
  QuoteResponse,
  ShiftResponse,
} from './types';

const CHANGENOW_API_URL = 'https://api.changenow.io';

// ChangeNOW specific types
export interface ChangeNowCurrency {
  ticker: string;
  name: string;
  network: string;
  hasExternalId: boolean;
  isFiat: boolean;
  isStable: boolean;
  supportsFixedRate: boolean;
}

export interface ChangeNowEstimate {
  estimatedAmount: number;
  transactionSpeedForecast: string;
  warningMessage: string | null;
  fromAmount?: number;
  toAmount?: number;
  rateId?: string; // For fixed rate
  validUntil?: string;
}

export interface ChangeNowMinAmount {
  minAmount: number;
}

export interface ChangeNowExchange {
  id: string;
  payinAddress: string;
  payoutAddress: string;
  payinExtraId?: string;
  fromCurrency: string;
  toCurrency: string;
  fromNetwork: string;
  toNetwork: string;
  amount: number;
  status: ChangeNowStatus;
  createdAt: string;
}

export type ChangeNowStatus =
  | 'new'
  | 'waiting'
  | 'confirming'
  | 'exchanging'
  | 'sending'
  | 'finished'
  | 'failed'
  | 'refunded'
  | 'expired';

/**
 * Supported coins for swaps - must match wallet support
 */
export const SWAP_SUPPORTED_COINS = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL',
  'BNB', 'DOGE', 'XRP', 'ADA',
  'USDT', 'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL',
] as const;
export type SwapCoin = (typeof SWAP_SUPPORTED_COINS)[number];

// Map our symbols to ChangeNOW format
const CN_COIN_MAP: Record<SwapCoin, { ticker: string; network: string }> = {
  // Native coins
  'BTC': { ticker: 'btc', network: 'btc' },
  'BCH': { ticker: 'bch', network: 'bch' },
  'ETH': { ticker: 'eth', network: 'eth' },
  'POL': { ticker: 'matic', network: 'matic' },
  'SOL': { ticker: 'sol', network: 'sol' },
  'BNB': { ticker: 'bnb', network: 'bsc' },
  'DOGE': { ticker: 'doge', network: 'doge' },
  'XRP': { ticker: 'xrp', network: 'xrp' },
  'ADA': { ticker: 'ada', network: 'ada' },
  // Stablecoins
  'USDT': { ticker: 'usdt', network: 'eth' },
  'USDC': { ticker: 'usdc', network: 'eth' },
  'USDC_ETH': { ticker: 'usdc', network: 'eth' },
  'USDC_POL': { ticker: 'usdc', network: 'matic' },
  'USDC_SOL': { ticker: 'usdc', network: 'sol' },
};

/**
 * Check if a coin is supported for swaps
 */
export function isSwapSupported(coin: string): coin is SwapCoin {
  return SWAP_SUPPORTED_COINS.includes(coin as SwapCoin);
}

class ChangeNowClient {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.CHANGENOW_API_KEY || '';
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    version: 'v1' | 'v2' = 'v1'
  ): Promise<T> {
    const url = `${CHANGENOW_API_URL}/${version}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // v2 requires API key in header
    if (version === 'v2' && this.apiKey) {
      headers['x-changenow-api-key'] = this.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `ChangeNOW API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get list of available currencies
   */
  async getCurrencies(): Promise<ChangeNowCurrency[]> {
    return this.request<ChangeNowCurrency[]>('/currencies?active=true');
  }

  /**
   * Get minimum exchange amount
   */
  async getMinAmount(from: string, to: string): Promise<ChangeNowMinAmount> {
    return this.request<ChangeNowMinAmount>(`/min-amount/${from}_${to}`);
  }

  /**
   * Get estimated exchange amount (standard/floating rate)
   */
  async getEstimate(
    from: string,
    to: string,
    amount: number
  ): Promise<ChangeNowEstimate> {
    return this.request<ChangeNowEstimate>(
      `/exchange-amount/${amount}/${from}_${to}`
    );
  }

  /**
   * Get estimated amount with fixed rate (requires API key)
   */
  async getFixedRateEstimate(
    from: string,
    fromNetwork: string,
    to: string,
    toNetwork: string,
    amount: number
  ): Promise<ChangeNowEstimate> {
    const params = new URLSearchParams({
      fromCurrency: from,
      toCurrency: to,
      fromAmount: amount.toString(),
      fromNetwork,
      toNetwork,
      flow: 'fixed-rate',
    });
    return this.request<ChangeNowEstimate>(
      `/exchange/estimated-amount?${params}`,
      {},
      'v2'
    );
  }

  /**
   * Create an exchange transaction
   */
  async createExchange(params: {
    from: string;
    to: string;
    amount: number;
    address: string;
    refundAddress?: string;
    extraId?: string;
    rateId?: string; // For fixed rate
  }): Promise<ChangeNowExchange> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error('CHANGENOW_API_KEY is required to create exchanges');
    }

    return this.request<ChangeNowExchange>(
      `/transactions/${apiKey}`,
      {
        method: 'POST',
        body: JSON.stringify({
          from: params.from,
          to: params.to,
          amount: params.amount,
          address: params.address,
          refundAddress: params.refundAddress,
          extraId: params.extraId,
          rateId: params.rateId,
        }),
      }
    );
  }

  /**
   * Get transaction status
   */
  async getTransaction(id: string): Promise<ChangeNowExchange> {
    return this.request<ChangeNowExchange>(`/transactions/${id}/${this.apiKey}`);
  }
}

// Singleton instance
let client: ChangeNowClient | null = null;

export function getChangeNowClient(): ChangeNowClient {
  if (!client) {
    client = new ChangeNowClient();
  }
  return client;
}

// For testing
export function resetClient(): void {
  client = null;
}

/**
 * High-level swap functions using our coin symbols
 */

export async function getSwapQuote(params: SwapQuoteParams): Promise<QuoteResponse> {
  const client = getChangeNowClient();
  
  // Validate coins are supported by our wallet
  if (!isSwapSupported(params.from)) {
    throw new Error(`Unsupported coin: ${params.from}. Supported: ${SWAP_SUPPORTED_COINS.join(', ')}`);
  }
  if (!isSwapSupported(params.to)) {
    throw new Error(`Unsupported coin: ${params.to}. Supported: ${SWAP_SUPPORTED_COINS.join(', ')}`);
  }
  if (params.from === params.to) {
    throw new Error('Cannot swap a coin for itself');
  }
  
  const fromMapping = CN_COIN_MAP[params.from];
  const toMapping = CN_COIN_MAP[params.to];

  const amount = parseFloat(params.amount);
  
  // Get estimate and min amount
  const [estimate, minAmount] = await Promise.all([
    client.getEstimate(fromMapping.ticker, toMapping.ticker, amount),
    client.getMinAmount(fromMapping.ticker, toMapping.ticker),
  ]);

  const rate = estimate.estimatedAmount / amount;

  return {
    depositCoin: fromMapping.ticker,
    depositNetwork: fromMapping.network,
    settleCoin: toMapping.ticker,
    settleNetwork: toMapping.network,
    depositAmount: params.amount,
    settleAmount: estimate.estimatedAmount.toString(),
    rate: rate.toString(),
    minAmount: minAmount.minAmount,
  };
}

export async function createSwap(params: SwapCreateParams & {
  from: string;
  to: string;
  amount: string;
  refundAddress?: string;
}): Promise<ShiftResponse> {
  const client = getChangeNowClient();
  
  // Validate coins are supported by our wallet
  if (!isSwapSupported(params.from)) {
    throw new Error(`Unsupported coin: ${params.from}. Supported: ${SWAP_SUPPORTED_COINS.join(', ')}`);
  }
  if (!isSwapSupported(params.to)) {
    throw new Error(`Unsupported coin: ${params.to}. Supported: ${SWAP_SUPPORTED_COINS.join(', ')}`);
  }
  if (params.from === params.to) {
    throw new Error('Cannot swap a coin for itself');
  }
  
  const fromMapping = CN_COIN_MAP[params.from];
  const toMapping = CN_COIN_MAP[params.to];

  const exchange = await client.createExchange({
    from: fromMapping.ticker,
    to: toMapping.ticker,
    amount: parseFloat(params.amount),
    address: params.settleAddress,
    refundAddress: params.refundAddress,
  });

  return {
    id: exchange.id,
    depositAddress: exchange.payinAddress,
    depositCoin: exchange.fromCurrency,
    depositNetwork: exchange.fromNetwork,
    depositAmount: exchange.amount.toString(),
    settleCoin: exchange.toCurrency,
    settleNetwork: exchange.toNetwork,
    settleAddress: exchange.payoutAddress,
    settleAmount: '', // Filled when complete
    status: mapStatus(exchange.status),
    createdAt: exchange.createdAt,
  };
}

export async function getSwapStatus(id: string): Promise<ShiftResponse> {
  const client = getChangeNowClient();
  const exchange = await client.getTransaction(id);

  return {
    id: exchange.id,
    depositAddress: exchange.payinAddress,
    depositCoin: exchange.fromCurrency,
    depositNetwork: exchange.fromNetwork,
    depositAmount: exchange.amount.toString(),
    settleCoin: exchange.toCurrency,
    settleNetwork: exchange.toNetwork,
    settleAddress: exchange.payoutAddress,
    settleAmount: '',
    status: mapStatus(exchange.status),
    createdAt: exchange.createdAt,
  };
}

function mapStatus(cnStatus: ChangeNowStatus): string {
  const statusMap: Record<ChangeNowStatus, string> = {
    'new': 'pending',
    'waiting': 'pending',
    'confirming': 'processing',
    'exchanging': 'processing',
    'sending': 'settling',
    'finished': 'settled',
    'failed': 'failed',
    'refunded': 'refunded',
    'expired': 'expired',
  };
  return statusMap[cnStatus] || cnStatus;
}

export async function getSupportedCoins(): Promise<ChangeNowCurrency[]> {
  const client = getChangeNowClient();
  return client.getCurrencies();
}

export { ChangeNowClient, CN_COIN_MAP };
