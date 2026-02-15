/**
 * Wallet SDK - Lightning Network Methods
 *
 * Extracted from wallet.ts for modularity.
 * These methods are mixed into the Wallet class.
 */

import type { WalletAPIClient } from './client';
import type {
  LightningAddress,
  LightningInvoice,
  LightningPayment,
  LightningPaymentStatus,
} from './types';

/**
 * Add Lightning methods to a wallet instance.
 * Called from the Wallet class constructor.
 */
export function createLightningMethods(
  client: WalletAPIClient,
  walletId: string,
  getMnemonic: () => string | null
) {
  return {
    /**
     * Get the Lightning Address for this wallet.
     */
    async getLightningAddress(): Promise<LightningAddress> {
      const data = await client.request<any>({
        method: 'GET',
        path: '/api/lightning/address',
        query: { wallet_id: walletId },
        authenticated: false,
      });
      return {
        lightning_address: data.lightning_address || null,
        username: data.username,
      };
    },

    /**
     * Register a Lightning Address (username@coinpayportal.com).
     */
    async setLightningAddress(username: string): Promise<LightningAddress> {
      const data = await client.request<any>({
        method: 'POST',
        path: '/api/lightning/address',
        body: { wallet_id: walletId, username },
        authenticated: true,
      });
      return {
        lightning_address: data.lightning_address,
        username: data.username,
      };
    },

    /**
     * Create a Lightning invoice (BOLT11).
     */
    async createLightningInvoice(amount: number, memo?: string): Promise<LightningInvoice> {
      const data = await client.request<any>({
        method: 'POST',
        path: '/api/lightning/invoices',
        body: {
          node_id: walletId,
          amount_sats: amount,
          description: memo || '',
          mnemonic: getMnemonic(),
        },
        authenticated: true,
      });
      return {
        payment_hash: data.data?.payment_hash || data.payment_hash,
        payment_request: data.data?.invoice?.bolt11 || data.payment_request,
        checking_id: data.data?.checking_id || data.checking_id,
      };
    },

    /**
     * Pay a Lightning invoice (BOLT11).
     */
    async payLightningInvoice(bolt11: string): Promise<LightningPayment> {
      const data = await client.request<any>({
        method: 'POST',
        path: '/api/lightning/payments',
        body: {
          node_id: walletId,
          bolt11,
          mnemonic: getMnemonic(),
        },
        authenticated: true,
      });
      return data.data || data;
    },

    /**
     * Check a Lightning payment status.
     */
    async checkLightningPayment(paymentHash: string): Promise<LightningPaymentStatus> {
      const data = await client.request<any>({
        method: 'GET',
        path: `/api/lightning/payments/${paymentHash}`,
        authenticated: true,
      });
      return { paid: data.paid ?? data.data?.paid ?? false };
    },

    /**
     * List Lightning payments.
     */
    async listLightningPayments(limit: number = 20): Promise<LightningPayment[]> {
      const data = await client.request<any>({
        method: 'GET',
        path: '/api/lightning/payments',
        query: { node_id: walletId, limit: String(limit) },
        authenticated: true,
      });
      return data.data?.payments || data.payments || [];
    },
  };
}
