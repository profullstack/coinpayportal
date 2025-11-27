/**
 * Payment utilities for CoinPay SDK
 */

import { CoinPayClient } from './client.js';

/**
 * Create a payment using a client instance or API key
 * @param {Object} params - Payment parameters
 * @param {string} params.apiKey - API key (if not using client)
 * @param {CoinPayClient} [params.client] - Existing client instance
 * @param {string} params.businessId - Business ID
 * @param {number} params.amount - Amount in fiat currency
 * @param {string} params.currency - Fiat currency code
 * @param {string} params.cryptocurrency - Cryptocurrency code
 * @param {string} [params.description] - Payment description
 * @param {string} [params.metadata] - Custom metadata
 * @param {string} [params.callbackUrl] - Webhook callback URL
 * @returns {Promise<Object>} Created payment
 */
export async function createPayment({
  apiKey,
  client,
  businessId,
  amount,
  currency,
  cryptocurrency,
  description,
  metadata,
  callbackUrl,
}) {
  const coinpay = client || new CoinPayClient({ apiKey });
  
  return coinpay.createPayment({
    businessId,
    amount,
    currency,
    cryptocurrency,
    description,
    metadata,
    callbackUrl,
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
 * Supported cryptocurrencies
 */
export const Cryptocurrency = {
  BTC: 'BTC',
  BCH: 'BCH',
  ETH: 'ETH',
  MATIC: 'MATIC',
  SOL: 'SOL',
};

/**
 * Supported fiat currencies
 */
export const FiatCurrency = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  CAD: 'CAD',
  AUD: 'AUD',
};

export default {
  createPayment,
  getPayment,
  listPayments,
  PaymentStatus,
  Cryptocurrency,
  FiatCurrency,
};