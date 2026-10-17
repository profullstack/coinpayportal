/**
 * Invoice SDK Module
 *
 * Create, manage, and send invoices with crypto + card payment support.
 * Invoices can be sent to clients who pay via generated crypto addresses
 * or optional Stripe checkout.
 *
 * @example
 * import { CoinPayClient } from '@profullstack/coinpay';
 * import { createInvoice, publishInvoice, sendInvoice, getInvoicePaymentData } from '@profullstack/coinpay';
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
 * @param {string} [options.businessId] - Business ID (optional for business-scoped API keys)
 * @param {string} [options.clientId] - Client ID (optional)
 * @param {string} options.currency - Fiat currency code (USD, EUR, etc.)
 * @param {number} [options.amount] - Invoice amount (omit when lineItems is given)
 * @param {Array<{description: string, quantity: number, unit_price: number, tax_rate?: number, tax_name?: string, item_id?: string}>} [options.lineItems]
 *   Itemised lines; the server computes the total from them
 * @param {{type: 'percent'|'fixed', value: number}} [options.discount] - Invoice-level discount, applied before tax
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
  lineItems,
  discount,
  cryptoCurrency,
  dueDate,
  notes,
  walletId,
  merchantWalletAddress,
}) {
  const body = {
    business_id: businessId,
    currency,
  };
  if (lineItems) {
    body.line_items = lineItems;
    if (discount) body.discount = discount;
  } else {
    body.amount = amount;
  }
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
  const data = await client.request(`/invoices/${encodeURIComponent(id)}`);
  return normalizeInvoice(data);
}

/**
 * Update an invoice
 * @param {CoinPayClient} client
 * @param {string} id - Invoice ID
 * @param {Object} updates - Partial invoice fields to update
 * @param {number} [updates.amount] - Updated amount (single-amount invoices only)
 * @param {Array|null} [updates.lineItems] - Replace the lines (null turns itemising off)
 * @param {Object|null} [updates.discount] - Replace the discount
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
  if (updates.lineItems !== undefined) body.line_items = updates.lineItems;
  if (updates.discount !== undefined) body.discount = updates.discount;
  if (updates.currency !== undefined) body.currency = updates.currency;
  if (updates.cryptoCurrency !== undefined) body.crypto_currency = updates.cryptoCurrency;
  if (updates.dueDate !== undefined) body.due_date = updates.dueDate;
  if (updates.notes !== undefined) body.notes = updates.notes;
  if (updates.clientId !== undefined) body.client_id = updates.clientId;
  if (updates.walletId !== undefined) body.wallet_id = updates.walletId;
  if (updates.merchantWalletAddress !== undefined) body.merchant_wallet_address = updates.merchantWalletAddress;

  const data = await client.request(`/invoices/${encodeURIComponent(id)}`, {
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
  return client.request(`/invoices/${encodeURIComponent(id)}`, {
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
  const data = await client.request(`/invoices/${encodeURIComponent(id)}/send`, {
    method: 'POST',
  });
  return data;
}

/**
 * Publish an invoice without emailing the client.
 * Generates live payment details that can be shared manually.
 * @param {CoinPayClient} client
 * @param {string} id - Draft invoice ID
 * @returns {Promise<Object>} Publish result with invoice and payment link
 */
export async function publishInvoice(client, id) {
  return client.request(`/invoices/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
  });
}

/**
 * Get invoice payment data (public, no auth required)
 * Used by clients/customers to view payment instructions.
 * @param {CoinPayClient} client
 * @param {string} id - Invoice ID
 * @returns {Promise<Object>} Payment data (address, amount, status, etc.)
 */
export async function getInvoicePaymentData(client, id) {
  const data = await client.requestUnauthenticated(`/invoices/${encodeURIComponent(id)}/pay`);
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

  // Single-invoice API responses are wrapped, while older SDK callers and
  // tests may still supply the invoice object directly.
  const invoice = data.invoice ?? data;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    businessId: invoice.business_id,
    clientId: invoice.client_id,
    currency: invoice.currency,
    amount: invoice.amount,
    lineItems: invoice.line_items,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    discountTotal: invoice.discount_total,
    taxTotal: invoice.tax_total,
    cryptoCurrency: invoice.crypto_currency,
    cryptoAmount: invoice.crypto_amount,
    status: invoice.status,
    dueDate: invoice.due_date,
    notes: invoice.notes,
    walletId: invoice.wallet_id,
    merchantWalletAddress: invoice.merchant_wallet_address,
    paymentAddress: invoice.payment_address,
    stripeCheckoutUrl: invoice.stripe_checkout_url,
    paidAt: invoice.paid_at,
    sentAt: invoice.sent_at,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Catalog: saved tax rates and products/services for itemised invoices.
// An API key is locked to its own business, so businessId is optional there.
// ---------------------------------------------------------------------------

function businessQuery(businessId) {
  return businessId ? '?business_id=' + encodeURIComponent(businessId) : '';
}

/** List a business's saved tax rates. */
export async function listTaxRates(client, { businessId } = {}) {
  const data = await client.request('/tax-rates' + businessQuery(businessId));
  return data.tax_rates ?? [];
}

/** Save a tax rate (percent, up to three decimals). */
export async function createTaxRate(client, { businessId, name, rate, isDefault }) {
  const body = { name, rate };
  if (businessId) body.business_id = businessId;
  if (isDefault !== undefined) body.is_default = isDefault;
  const data = await client.request('/tax-rates', { method: 'POST', body: JSON.stringify(body) });
  return data.tax_rate;
}

export async function deleteTaxRate(client, id) {
  return client.request('/tax-rates/' + encodeURIComponent(id), { method: 'DELETE' });
}

/** List a business's saved products and services. */
export async function listInvoiceItems(client, { businessId } = {}) {
  const data = await client.request('/invoice-items' + businessQuery(businessId));
  return data.invoice_items ?? [];
}

/** Save a product or service to bill again later. */
export async function createInvoiceItem(client, { businessId, name, unitPrice, description, unit, taxRateId }) {
  const body = { name, unit_price: unitPrice };
  if (businessId) body.business_id = businessId;
  if (description) body.description = description;
  if (unit) body.unit = unit;
  if (taxRateId) body.tax_rate_id = taxRateId;
  const data = await client.request('/invoice-items', { method: 'POST', body: JSON.stringify(body) });
  return data.invoice_item;
}

export async function deleteInvoiceItem(client, id) {
  return client.request('/invoice-items/' + encodeURIComponent(id), { method: 'DELETE' });
}
