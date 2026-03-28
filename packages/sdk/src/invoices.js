/**
 * Invoice SDK Module
 *
 * Create, manage, and send invoices with crypto + card payment support.
 * Invoices can be sent to clients who pay via generated crypto addresses
 * or optional Stripe checkout.
 *
 * @example
 * import { CoinPayClient } from '@profullstack/coinpay';
 * import { createInvoice, sendInvoice, getInvoicePaymentData } from '@profullstack/coinpay';
 *
 * const client = new CoinPayClient({ apiKey: 'your-key' });
 *
 * // Create an invoice
 * const invoice = await createInvoice(client, {
 *   businessId: 'biz_123',
 *   currency: 'USD',
 *   amount: 250.00,
 *   cryptoCurrency: 'ETH',
 *   dueDate: '2026-04-01',
 *   notes: 'Web development - March 2026',
 * });
 *
 * // Send it to the client
 * const sent = await sendInvoice(client, invoice.id);
 *
 * // Public: get payment data (no auth)
 * const paymentData = await getInvoicePaymentData(client, invoice.id);
 */

/**
 * Create a new invoice
 * @param {CoinPayClient} client - API client instance
 * @param {Object} options - Invoice parameters
 * @param {string} options.businessId - Business ID
 * @param {string} [options.clientId] - Client ID (optional)
 * @param {string} options.currency - Fiat currency code (USD, EUR, etc.)
 * @param {number} options.amount - Invoice amount
 * @param {string} [options.cryptoCurrency] - Preferred crypto for payment
 * @param {string} [options.dueDate] - Due date (ISO string or YYYY-MM-DD)
 * @param {string} [options.notes] - Notes / description
 * @param {string} [options.walletId] - Wallet ID for receiving payment
 * @param {string} [options.merchantWalletAddress] - Direct wallet address for receiving payment
 * @returns {Promise<Object>} Created invoice
 */
export async function createInvoice(client, {
  businessId,
  clientId,
  currency,
  amount,
  cryptoCurrency,
  dueDate,
  notes,
  walletId,
  merchantWalletAddress,
}) {
  const body = {
    business_id: businessId,
    currency,
    amount,
  };
  if (clientId) body.client_id = clientId;
  if (cryptoCurrency) body.crypto_currency = cryptoCurrency;
  if (dueDate) body.due_date = dueDate;
  if (notes) body.notes = notes;
  if (walletId) body.wallet_id = walletId;
  if (merchantWalletAddress) body.merchant_wallet_address = merchantWalletAddress;

  const data = await client.request('/invoices', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return normalizeInvoice(data);
}

/**
 * List invoices with optional filters
 * @param {CoinPayClient} client
 * @param {Object} [filters]
 * @param {string} [filters.businessId] - Filter by business ID
 * @param {string} [filters.status] - Filter by status (draft, sent, paid, overdue, cancelled)
 * @param {string} [filters.clientId] - Filter by client ID
 * @param {string} [filters.dateFrom] - Filter from date (ISO string)
 * @param {string} [filters.dateTo] - Filter to date (ISO string)
 * @returns {Promise<Object>} { invoices, total?, ... }
 */
export async function listInvoices(client, filters = {}) {
  const params = new URLSearchParams();
  if (filters.businessId) params.set('business_id', filters.businessId);
  if (filters.status) params.set('status', filters.status);
  if (filters.clientId) params.set('client_id', filters.clientId);
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);

  const query = params.toString();
  const endpoint = query ? `/invoices?${query}` : '/invoices';
  const data = await client.request(endpoint);

  // Handle both array and paginated responses
  if (Array.isArray(data)) {
    return { invoices: data.map(normalizeInvoice) };
  }

  return {
    invoices: (data.invoices || []).map(normalizeInvoice),
    total: data.total,
  };
}

/**
 * Get a single invoice by ID
 * @param {CoinPayClient} client
 * @param {string} id - Invoice ID
 * @returns {Promise<Object>} Invoice details
 */
export async function getInvoice(client, id) {
  const data = await client.request(`/invoices/${id}`);
  return normalizeInvoice(data);
}

/**
 * Update an invoice
 * @param {CoinPayClient} client
 * @param {string} id - Invoice ID
 * @param {Object} updates - Partial invoice fields to update
 * @param {number} [updates.amount] - Updated amount
 * @param {string} [updates.currency] - Updated currency
 * @param {string} [updates.cryptoCurrency] - Updated crypto currency
 * @param {string} [updates.dueDate] - Updated due date
 * @param {string} [updates.notes] - Updated notes
 * @param {string} [updates.clientId] - Updated client ID
 * @param {string} [updates.walletId] - Updated wallet ID
 * @param {string} [updates.merchantWalletAddress] - Updated wallet address
 * @returns {Promise<Object>} Updated invoice
 */
export async function updateInvoice(client, id, updates) {
  const body = {};
  if (updates.amount !== undefined) body.amount = updates.amount;
  if (updates.currency !== undefined) body.currency = updates.currency;
  if (updates.cryptoCurrency !== undefined) body.crypto_currency = updates.cryptoCurrency;
  if (updates.dueDate !== undefined) body.due_date = updates.dueDate;
  if (updates.notes !== undefined) body.notes = updates.notes;
  if (updates.clientId !== undefined) body.client_id = updates.clientId;
  if (updates.walletId !== undefined) body.wallet_id = updates.walletId;
  if (updates.merchantWalletAddress !== undefined) body.merchant_wallet_address = updates.merchantWalletAddress;

  const data = await client.request(`/invoices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  return normalizeInvoice(data);
}

/**
 * Delete a draft invoice
 * @param {CoinPayClient} client
 * @param {string} id - Invoice ID (must be in draft status)
 * @returns {Promise<Object>} Deletion confirmation
 */
export async function deleteInvoice(client, id) {
  return client.request(`/invoices/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Send an invoice to the client
 * Generates a payment address and optional Stripe checkout link.
 * @param {CoinPayClient} client
 * @param {string} id - Invoice ID
 * @returns {Promise<Object>} Send result with payment details
 */
export async function sendInvoice(client, id) {
  const data = await client.request(`/invoices/${id}/send`, {
    method: 'POST',
  });
  return data;
}

/**
 * Get invoice payment data (public, no auth required)
 * Used by clients/customers to view payment instructions.
 * @param {CoinPayClient} client
 * @param {string} id - Invoice ID
 * @returns {Promise<Object>} Payment data (address, amount, status, etc.)
 */
export async function getInvoicePaymentData(client, id) {
  const data = await client.requestUnauthenticated(`/invoices/${id}/pay`);
  return data;
}

// ── Constants ──

/**
 * Invoice status constants
 */
export const InvoiceStatus = {
  DRAFT: 'draft',
  SENT: 'sent',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
};

// ── Helpers ──

function normalizeInvoice(data) {
  if (!data) return data;
  return {
    id: data.id,
    businessId: data.business_id,
    clientId: data.client_id,
    currency: data.currency,
    amount: data.amount,
    cryptoCurrency: data.crypto_currency,
    cryptoAmount: data.crypto_amount,
    status: data.status,
    dueDate: data.due_date,
    notes: data.notes,
    walletId: data.wallet_id,
    merchantWalletAddress: data.merchant_wallet_address,
    paymentAddress: data.payment_address,
    stripeCheckoutUrl: data.stripe_checkout_url,
    paidAt: data.paid_at,
    sentAt: data.sent_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
