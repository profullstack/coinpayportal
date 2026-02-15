/**
 * Wallet SDK - Swap Methods
 *
 * Extracted from wallet.ts for modularity.
 */

import type { WalletAPIClient } from './client';
import type { SwapQuote, SwapCreateParams, Swap, SwapCoin, SwapHistoryOptions } from './types';

function mapSwap(raw: any): Swap {
  return {
    id: raw.id,
    from: raw.from_coin || raw.from || raw.depositCoin,
    to: raw.to_coin || raw.to || raw.settleCoin,
    depositAddress: raw.deposit_address || raw.depositAddress,
    depositAmount: raw.deposit_amount || raw.depositAmount,
    settleAddress: raw.settle_address || raw.settleAddress,
    settleAmount: raw.settle_amount || raw.settleAmount || null,
    status: raw.status,
    createdAt: raw.created_at || raw.createdAt,
    expiresAt: raw.expires_at || raw.expiresAt,
  };
}

export function createSwapMethods(client: WalletAPIClient, walletId: string) {
  return {
    async getSwapQuote(from: string, to: string, amount: string): Promise<SwapQuote> {
      const data = await client.request<any>({
        method: 'GET',
        path: '/api/swap/quote',
        query: { from, to, amount },
        authenticated: false,
      });
      return {
        from: data.from || from,
        to: data.to || to,
        depositAmount: data.depositAmount,
        settleAmount: data.settleAmount,
        rate: data.rate,
        minAmount: data.minAmount,
        expiresAt: data.expiresAt,
      };
    },

    async createSwap(params: SwapCreateParams): Promise<Swap> {
      const data = await client.request<any>({
        method: 'POST',
        path: '/api/swap/create',
        body: {
          from: params.from,
          to: params.to,
          amount: params.amount,
          settleAddress: params.settleAddress,
          refundAddress: params.refundAddress,
          walletId: params.walletId || walletId,
        },
        authenticated: false,
      });
      return mapSwap(data.swap || data);
    },

    async getSwapStatus(swapId: string): Promise<Swap> {
      const data = await client.request<any>({
        method: 'GET',
        path: `/api/swap/${swapId}`,
        authenticated: false,
      });
      return mapSwap(data.swap || data);
    },

    async getSwapHistory(options?: SwapHistoryOptions): Promise<Swap[]> {
      const data = await client.request<any>({
        method: 'GET',
        path: '/api/swap/history',
        query: {
          walletId,
          status: options?.status,
          limit: options?.limit?.toString(),
          offset: options?.offset?.toString(),
        },
        authenticated: true,
      });
      return (data.swaps || []).map(mapSwap);
    },

    async getSwapCoins(): Promise<SwapCoin[]> {
      const data = await client.request<any>({
        method: 'GET',
        path: '/api/swap/coins',
        authenticated: false,
      });
      return data.coins || [];
    },
  };
}
