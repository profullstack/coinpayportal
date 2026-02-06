/**
 * SideShift.ai API client for no-KYC coin swaps
 * Docs: https://docs.sideshift.ai/
 */

import {
  SideshiftCoin,
  SideshiftPair,
  QuoteRequest,
  QuoteResponse,
  ShiftRequest,
  ShiftResponse,
  COIN_NETWORK_MAP,
  SwapQuoteParams,
  SwapCreateParams,
} from './types';

const SIDESHIFT_API_URL = 'https://sideshift.ai/api/v2';

class SideshiftClient {
  private secret: string;
  private affiliateId: string;

  constructor() {
    this.secret = process.env.SIDESHIFT_SECRET || '';
    this.affiliateId = process.env.SIDESHIFT_AFFILIATE_ID || '';
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.secret) {
      headers['x-sideshift-secret'] = this.secret;
    }

    const response = await fetch(`${SIDESHIFT_API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `SideShift API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get list of supported coins
   */
  async getCoins(): Promise<SideshiftCoin[]> {
    return this.request<SideshiftCoin[]>('/coins');
  }

  /**
   * Get available trading pairs
   */
  async getPairs(): Promise<SideshiftPair[]> {
    return this.request<SideshiftPair[]>('/pairs');
  }

  /**
   * Get a specific pair's info
   */
  async getPair(
    depositCoin: string,
    depositNetwork: string,
    settleCoin: string,
    settleNetwork: string
  ): Promise<SideshiftPair> {
    const pair = `${depositCoin}-${depositNetwork}/${settleCoin}-${settleNetwork}`;
    return this.request<SideshiftPair>(`/pair/${pair}`);
  }

  /**
   * Get a quote for a swap (fixed rate)
   */
  async getQuote(params: QuoteRequest): Promise<QuoteResponse> {
    return this.request<QuoteResponse>('/quotes', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        affiliateId: params.affiliateId || this.affiliateId,
      }),
    });
  }

  /**
   * Create a shift (fixed rate swap)
   */
  async createShift(params: ShiftRequest): Promise<ShiftResponse> {
    return this.request<ShiftResponse>('/shifts/fixed', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        affiliateId: params.affiliateId || this.affiliateId,
      }),
    });
  }

  /**
   * Create a variable rate shift (no quote needed)
   */
  async createVariableShift(params: {
    depositCoin: string;
    depositNetwork: string;
    settleCoin: string;
    settleNetwork: string;
    settleAddress: string;
    refundAddress?: string;
  }): Promise<ShiftResponse> {
    return this.request<ShiftResponse>('/shifts/variable', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        affiliateId: this.affiliateId,
      }),
    });
  }

  /**
   * Get shift status
   */
  async getShift(shiftId: string): Promise<ShiftResponse> {
    return this.request<ShiftResponse>(`/shifts/${shiftId}`);
  }
}

// Singleton instance
let client: SideshiftClient | null = null;

export function getSideshiftClient(): SideshiftClient {
  if (!client) {
    client = new SideshiftClient();
  }
  return client;
}

/**
 * High-level swap functions using our coin symbols
 */
export async function getSwapQuote(params: SwapQuoteParams): Promise<QuoteResponse> {
  const client = getSideshiftClient();
  
  const fromMapping = COIN_NETWORK_MAP[params.from];
  const toMapping = COIN_NETWORK_MAP[params.to];
  
  if (!fromMapping || !toMapping) {
    throw new Error(`Unsupported coin pair: ${params.from} -> ${params.to}`);
  }

  const quoteParams: QuoteRequest = {
    depositCoin: fromMapping.coin,
    depositNetwork: params.fromNetwork || fromMapping.network,
    settleCoin: toMapping.coin,
    settleNetwork: params.toNetwork || toMapping.network,
  };

  if (params.amountType === 'settle') {
    quoteParams.settleAmount = params.amount;
  } else {
    quoteParams.depositAmount = params.amount;
  }

  return client.getQuote(quoteParams);
}

export async function createSwap(params: SwapCreateParams): Promise<ShiftResponse> {
  const client = getSideshiftClient();
  return client.createShift(params);
}

export async function getSwapStatus(shiftId: string): Promise<ShiftResponse> {
  const client = getSideshiftClient();
  return client.getShift(shiftId);
}

export async function getSupportedCoins(): Promise<SideshiftCoin[]> {
  const client = getSideshiftClient();
  return client.getCoins();
}

export { SideshiftClient };
