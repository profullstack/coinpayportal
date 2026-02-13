/**
 * CoinPay Payouts - Functions for Stripe Connect payouts
 * 
 * Manage payouts to connected Stripe accounts (merchants).
 */

/**
 * Create a payout to a connected Stripe account
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {Object} params - Payout parameters
 * @param {number} params.amount - Amount in cents (e.g., 5000 = $50.00)
 * @param {string} [params.currency='usd'] - Currency code
 * @param {string} [params.description] - Payout description
 * @param {Object} [params.metadata] - Custom metadata
 * @returns {Promise<Object>} Created payout
 * 
 * @example
 * const payout = await createPayout(client, {
 *   amount: 5000,
 *   currency: 'usd',
 *   description: 'Weekly payout'
 * });
 */
export async function createPayout(client, { amount, currency = 'usd', description, metadata }) {
  return client.request('/stripe/payouts', {
    method: 'POST',
    body: JSON.stringify({ amount, currency, description, metadata }),
  });
}

/**
 * List payouts for the authenticated merchant
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.status] - Filter by status (pending, paid, failed, canceled)
 * @param {string} [filters.dateFrom] - Filter from date (ISO string)
 * @param {string} [filters.dateTo] - Filter to date (ISO string)
 * @param {number} [filters.limit=50] - Number of results
 * @param {number} [filters.offset=0] - Pagination offset
 * @returns {Promise<Object>} List of payouts with pagination
 */
export async function listPayouts(client, filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));

  const qs = params.toString();
  return client.request(`/stripe/payouts${qs ? '?' + qs : ''}`);
}

/**
 * Get a specific payout by ID
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} payoutId - Payout ID
 * @returns {Promise<Object>} Payout details
 */
export async function getPayout(client, payoutId) {
  return client.request(`/stripe/payouts/${payoutId}`);
}

/**
 * Format payout amount from cents to display string
 * 
 * @param {number} amountCents - Amount in cents
 * @param {string} [currency='usd'] - Currency code
 * @returns {string} Formatted amount (e.g., "$50.00")
 */
export function formatPayoutAmount(amountCents, currency = 'usd') {
  const amount = (amountCents / 100).toFixed(2);
  const symbols = { usd: '$', eur: '€', gbp: '£' };
  const symbol = symbols[currency.toLowerCase()] || currency.toUpperCase() + ' ';
  return `${symbol}${amount}`;
}
