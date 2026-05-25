import { CoinPayClient } from './client.js';

/**
 * List checkout tokens for a business.
 * @param {Object} params
 * @param {string} [params.apiKey] - API key if not using client
 * @param {CoinPayClient} [params.client] - Existing client
 * @param {string} [params.businessId] - Business ID
 * @param {boolean} [params.activeOnly] - Only return active wallets
 * @returns {Promise<Object>} Tokens response
 */
export async function getTokens({ apiKey, client, businessId, activeOnly } = {}) {
  const coinpay = client || new CoinPayClient({ apiKey });
  return coinpay.getTokens({ businessId, activeOnly });
}

/**
 * List supported coins for a business.
 * @param {Object} params
 * @param {string} [params.apiKey] - API key if not using client
 * @param {CoinPayClient} [params.client] - Existing client
 * @param {string} [params.businessId] - Business ID
 * @param {boolean} [params.activeOnly] - Only return active wallets
 * @returns {Promise<Object>} Supported coins response
 */
export async function getSupportedCoins({ apiKey, client, businessId, activeOnly } = {}) {
  const coinpay = client || new CoinPayClient({ apiKey });
  return coinpay.getSupportedCoins({ businessId, activeOnly });
}

export default {
  getTokens,
  getSupportedCoins,
};
