/**
 * Wallet SDK - Exchange Engine methods (/api/exchange/*).
 *
 * Every call is signed by the wallet, so it works in the engine's internal
 * mode as well as public mode. The wallet executes an order's nextAction
 * itself; the server never signs anything.
 */

import type { WalletAPIClient } from './client';

export interface ExchangeQuote {
  id: string;
  provider: 'thorchain' | 'changenow' | string;
  from: string;
  to: string;
  amountIn: string;
  expectedAmountOut: string;
  fees: Record<string, unknown>;
  minAmountIn: string | null;
  expiresAt: string | null;
  etaSeconds: number | null;
  verification: 'none' | 'provider_may_require';
  warnings: string[];
  /** CoinPay's fee in the source asset, already taken off before quoting. */
  coinpayFee: { amount: string; asset: string; bps: number; tier: 'free' | 'paid' } | null;
}

/** CoinPay's fee leg: a second send from the wallet, after the deposit. */
export interface ExchangePlanFee {
  to: string;
  amount: string;
  bps: number;
}

export interface ExchangeQuotesResult {
  quotes: ExchangeQuote[];
  unavailable: Array<{ provider: string; reason: string; code: string }>;
  disclosure: string;
}

export type ExchangeNextAction =
  | { kind: 'send'; chain: string; to: string; amount: string; extraId?: string; expiresAt: number | null; fee?: ExchangePlanFee }
  | { kind: 'send_with_memo'; chain: string; to: string; amount: string; memo: string; router?: string; expiresAt: number | null; fee?: ExchangePlanFee };

export interface ExchangeOrder {
  id: string;
  status: string;
  provider: string;
  from: string;
  to: string;
  amountIn: string;
  expectedAmountOut: string | null;
  amountOut: string | null;
  destinationAddress: string;
  refundAddress: string | null;
  nextAction: ExchangeNextAction | null;
  fee: { amount: string; asset: string; bps: number; tier: string | null; address: string | null; txHash: string | null; paid: boolean } | null;
  providerOrderId: string | null;
  providerStatus: string | null;
  inTxHash: string | null;
  outTxHash: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Plans the CoinPay web wallet can execute today (a plain transfer). */
export function isWalletExecutable(provider: string): boolean {
  return provider === 'changenow';
}

export function createExchangeMethods(client: WalletAPIClient) {
  return {
    async getExchangeQuotes(params: { from: string; to: string; amount: string; destinationAddress?: string }): Promise<ExchangeQuotesResult> {
      const data = await client.request<any>({
        method: 'POST',
        path: '/api/exchange/quotes',
        body: params,
        authenticated: true,
      });
      return { quotes: data.quotes ?? [], unavailable: data.unavailable ?? [], disclosure: data.disclosure ?? '' };
    },

    async createExchangeOrder(params: { quoteId: string; destinationAddress: string; refundAddress?: string; idempotencyKey: string }): Promise<ExchangeOrder> {
      const data = await client.request<any>({
        method: 'POST',
        path: '/api/exchange/orders',
        body: params,
        authenticated: true,
      });
      return data.order;
    },

    async submitExchangeTx(orderId: string, txHash: string): Promise<ExchangeOrder> {
      const data = await client.request<any>({
        method: 'POST',
        path: `/api/exchange/orders/${orderId}/submit`,
        body: { txHash },
        authenticated: true,
      });
      return data.order;
    },

    /** Record the separate transaction that paid CoinPay's fee. */
    async submitExchangeFeeTx(orderId: string, feeTxHash: string): Promise<ExchangeOrder> {
      const data = await client.request<any>({
        method: 'POST',
        path: `/api/exchange/orders/${orderId}/submit`,
        body: { feeTxHash },
        authenticated: true,
      });
      return data.order;
    },

    async getExchangeOrder(orderId: string): Promise<ExchangeOrder> {
      const data = await client.request<any>({
        method: 'GET',
        path: `/api/exchange/orders/${orderId}`,
        authenticated: true,
      });
      return data.order;
    },

    async listExchangeOrders(limit = 50): Promise<ExchangeOrder[]> {
      const data = await client.request<any>({
        method: 'GET',
        path: '/api/exchange/orders',
        query: { limit: String(limit) },
        authenticated: true,
      });
      return data.orders ?? [];
    },

    async cancelExchangeOrder(orderId: string): Promise<ExchangeOrder> {
      const data = await client.request<any>({
        method: 'POST',
        path: `/api/exchange/orders/${orderId}/cancel`,
        body: {},
        authenticated: true,
      });
      return data.order;
    },
  };
}
