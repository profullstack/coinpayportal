/**
 * Payment utilities for CoinPay SDK
 *
 * This module provides helper functions for creating and managing cryptocurrency payments.
 *
 * @example
 * // Quick payment creation
 * import { createPayment } from '@coinpay/sdk';
 *
 * const payment = await createPayment({
 *   apiKey: 'cp_live_xxxxx',
 *   businessId: 'your-business-id',
 *   amount: 100.00,
 *   blockchain: 'ETH',
 *   description: 'Order #12345'
 * });
 */

import { CoinPayClient } from './client.js';

/**
 * Create a payment using a client instance or API key
 *
 * This is a convenience function for creating payments without manually
 * instantiating a client. For multiple operations, create a client instance
 * and reuse it.
 *
 * @param {Object} params - Payment parameters
 * @param {string} params.apiKey - API key (required if not using client)
 * @param {CoinPayClient} [params.client] - Existing client instance (optional)
 * @param {string} params.businessId - Business ID from your CoinPay dashboard
 * @param {number} params.amount - Amount in fiat currency (e.g., 100.00)
 * @param {string} [params.currency='USD'] - Fiat currency code (USD, EUR, etc.)
 * @param {string} params.blockchain - Blockchain to use (BTC, ETH, SOL, POL, BCH, USDC_ETH, USDC_POL, USDC_SOL)
 * @param {string} [params.description] - Payment description shown to customer
 * @param {Object} [params.metadata] - Custom metadata for your records
 * @returns {Promise<Object>} Created payment with address and QR code
 *
 * @example
 * // Create a Bitcoin payment
 * const payment = await createPayment({
 *   apiKey: 'cp_live_xxxxx',
 *   businessId: 'biz_123',
 *   amount: 50.00,
 *   currency: 'USD',
 *   blockchain: 'BTC',
 *   description: 'Premium subscription',
 *   metadata: { userId: 'user_456', plan: 'premium' }
 * });
 *
 * console.log('Payment address:', payment.payment.payment_address);
 * console.log('Amount in BTC:', payment.payment.crypto_amount);
 */
export async function createPayment({
  apiKey,
  client,
  businessId,
  amount,
  currency = 'USD',
  blockchain,
  description,
  metadata,
}) {
  const coinpay = client || new CoinPayClient({ apiKey });
  
  return coinpay.createPayment({
    businessId,
    amount,
    currency,
    blockchain,
    description,
    metadata,
  });
}

/**
 * Get payment by ID
 * @param {Object} params - Parameters
 * @param {string} params.apiKey - API key (if not using client)
 * @param {CoinPayClient} [params.client] - Existing client instance
 * @param {string} params.paymentId - Payment ID
 * @returns {Promise<Object>} Payment details
 */
export async function getPayment({ apiKey, client, paymentId }) {
  const coinpay = client || new CoinPayClient({ apiKey });
  return coinpay.getPayment(paymentId);
}

/**
 * List payments
 * @param {Object} params - Parameters
 * @param {string} params.apiKey - API key (if not using client)
 * @param {CoinPayClient} [params.client] - Existing client instance
 * @param {string} params.businessId - Business ID
 * @param {string} [params.status] - Filter by status
 * @param {number} [params.limit] - Number of results
 * @param {number} [params.offset] - Pagination offset
 * @returns {Promise<Object>} List of payments
 */
export async function listPayments({
  apiKey,
  client,
  businessId,
  status,
  limit,
  offset,
}) {
  const coinpay = client || new CoinPayClient({ apiKey });
  return coinpay.listPayments({ businessId, status, limit, offset });
}

/**
 * Payment status constants
 */
export const PaymentStatus = {
  PENDING: 'pending',
  CONFIRMING: 'confirming',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  FAILED: 'failed',
  REFUNDED: 'refunded',
};

/**
 * Supported blockchains/cryptocurrencies
 *
 * Use these constants when creating payments to ensure valid blockchain values.
 *
 * @example
 * import { Blockchain, createPayment } from '@coinpay/sdk';
 *
 * const payment = await createPayment({
 *   apiKey: 'cp_live_xxxxx',
 *   businessId: 'biz_123',
 *   amount: 100,
 *   blockchain: Blockchain.ETH
 * });
 */
export const Blockchain = {
  /** Bitcoin */
  BTC: 'BTC',
  /** Bitcoin Cash */
  BCH: 'BCH',
  /** Ethereum */
  ETH: 'ETH',
  /** Polygon (POL) */
  POL: 'POL',
  /** Solana */
  SOL: 'SOL',
  /** USDC on Ethereum */
  USDC_ETH: 'USDC_ETH',
  /** USDC on Polygon */
  USDC_POL: 'USDC_POL',
  /** USDC on Solana */
  USDC_SOL: 'USDC_SOL',
};

/**
 * @deprecated Use Blockchain instead
 */
export const Cryptocurrency = Blockchain;

/**
 * Supported fiat currencies
 */
export const FiatCurrency = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  CAD: 'CAD',
  AUD: 'AUD',
  JPY: 'JPY',
  CHF: 'CHF',
  CNY: 'CNY',
  INR: 'INR',
  BRL: 'BRL',
};

export default {
  createPayment,
  getPayment,
  listPayments,
  PaymentStatus,
  Blockchain,
  Cryptocurrency,
  FiatCurrency,
};