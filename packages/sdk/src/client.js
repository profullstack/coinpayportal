/**
 * CoinPay API Client
 * Main client class for interacting with the CoinPay API
 */

const DEFAULT_BASE_URL = 'https://coinpayportal.com/api';

/**
 * CoinPay API Client
 */
export class CoinPayClient {
  #apiKey;
  #baseUrl;
  #timeout;

  /**
   * Create a new CoinPay client
   * @param {Object} options - Client options
   * @param {string} options.apiKey - Your CoinPay API key
   * @param {string} [options.baseUrl] - API base URL (default: https://coinpayportal.com/api)
   * @param {number} [options.timeout] - Request timeout in ms (default: 30000)
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, timeout = 30000 }) {
    if (!apiKey) {
      throw new Error('API key is required');
    }

    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.#timeout = timeout;
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint
   * @param {Object} [options] - Fetch options
   * @returns {Promise<Object>} API response
   */
  async request(endpoint, options = {}) {
    const url = `${this.#baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.#timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.response = data;
        throw error;
      }

      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.#timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Create a new payment
   *
   * This is the primary method for merchants to create payment requests.
   * When a customer needs to pay, call this method to generate a unique
   * payment address and QR code.
   *
   * @param {Object} params - Payment parameters
   * @param {string} params.businessId - Business ID (from your CoinPay dashboard)
   * @param {number} params.amount - Amount in fiat currency (e.g., 100.00)
   * @param {string} [params.currency='USD'] - Fiat currency code (USD, EUR, etc.)
   * @param {string} params.blockchain - Blockchain/cryptocurrency (BTC, ETH, SOL, POL, BCH, USDC_ETH, USDC_POL, USDC_SOL)
   * @param {string} [params.description] - Payment description (shown to customer)
   * @param {Object} [params.metadata] - Custom metadata (e.g., { orderId: 'ORD-123', customerId: 'CUST-456' })
   * @returns {Promise<Object>} Created payment with address and QR code
   *
   * @example
   * // Create a $50 payment in Bitcoin
   * const payment = await client.createPayment({
   *   businessId: 'your-business-id',
   *   amount: 50.00,
   *   currency: 'USD',
   *   blockchain: 'BTC',
   *   description: 'Order #12345',
   *   metadata: { orderId: '12345', customerEmail: 'customer@example.com' }
   * });
   *
   * // Display payment.payment_address and payment.qr_code to customer
   */
  async createPayment({
    businessId,
    amount,
    currency = 'USD',
    blockchain,
    description,
    metadata,
  }) {
    // Map to API field names (snake_case)
    return this.request('/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: businessId,
        amount,
        currency,
        blockchain: blockchain?.toUpperCase(),
        description,
        metadata,
      }),
    });
  }

  /**
   * Get payment by ID
   *
   * Use this to check the current status of a payment. You can poll this
   * endpoint to wait for payment completion, or use webhooks for real-time
   * notifications.
   *
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} Payment details including status
   *
   * @example
   * const result = await client.getPayment('pay_abc123');
   * console.log(result.payment.status); // 'pending', 'confirmed', 'forwarded', etc.
   */
  async getPayment(paymentId) {
    return this.request(`/payments/${paymentId}`);
  }

  /**
   * Wait for payment to reach a terminal status
   *
   * Polls the payment status until it reaches a terminal state (confirmed,
   * forwarded, expired, or failed). Useful for simple integrations that
   * don't use webhooks.
   *
   * For production use, webhooks are recommended over polling.
   *
   * @param {string} paymentId - Payment ID
   * @param {Object} [options] - Polling options
   * @param {number} [options.interval=5000] - Polling interval in ms (default: 5 seconds)
   * @param {number} [options.timeout=3600000] - Maximum wait time in ms (default: 1 hour)
   * @param {string[]} [options.targetStatuses] - Statuses to wait for (default: ['confirmed', 'forwarded', 'expired', 'failed'])
   * @param {Function} [options.onStatusChange] - Callback when status changes
   * @returns {Promise<Object>} Final payment details
   *
   * @example
   * // Simple usage - wait for payment to complete
   * const payment = await client.waitForPayment('pay_abc123');
   * if (payment.payment.status === 'confirmed' || payment.payment.status === 'forwarded') {
   *   console.log('Payment successful!');
   * }
   *
   * @example
   * // With status change callback
   * const payment = await client.waitForPayment('pay_abc123', {
   *   interval: 3000,
   *   timeout: 600000, // 10 minutes
   *   onStatusChange: (status, payment) => {
   *     console.log(`Payment status: ${status}`);
   *   }
   * });
   */
  async waitForPayment(paymentId, options = {}) {
    const {
      interval = 5000,
      timeout = 3600000,
      targetStatuses = ['confirmed', 'forwarded', 'expired', 'failed'],
      onStatusChange,
    } = options;

    const startTime = Date.now();
    let lastStatus = null;

    while (Date.now() - startTime < timeout) {
      const result = await this.getPayment(paymentId);
      const currentStatus = result.payment?.status;

      // Notify on status change
      if (currentStatus !== lastStatus) {
        if (onStatusChange && lastStatus !== null) {
          onStatusChange(currentStatus, result.payment);
        }
        lastStatus = currentStatus;
      }

      // Check if we've reached a target status
      if (targetStatuses.includes(currentStatus)) {
        return result;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Payment status check timed out after ${timeout}ms`);
  }

  /**
   * List payments for a business
   * @param {Object} params - Query parameters
   * @param {string} params.businessId - Business ID
   * @param {string} [params.status] - Filter by status
   * @param {number} [params.limit] - Number of results (default: 20)
   * @param {number} [params.offset] - Pagination offset
   * @returns {Promise<Object>} List of payments
   */
  async listPayments({ businessId, status, limit = 20, offset = 0 }) {
    const params = new URLSearchParams({
      businessId,
      limit: String(limit),
      offset: String(offset),
    });

    if (status) {
      params.set('status', status);
    }

    return this.request(`/payments?${params.toString()}`);
  }

  /**
   * Get payment QR code URL
   *
   * Returns the URL to the QR code image endpoint. The endpoint returns
   * binary PNG image data that can be used directly in an <img> tag.
   *
   * @param {string} paymentId - Payment ID
   * @returns {string} URL to the QR code image
   *
   * @example
   * // Get QR code URL for use in HTML
   * const qrUrl = client.getPaymentQRUrl('pay_abc123');
   * // Use in HTML: <img src={qrUrl} alt="Payment QR Code" />
   */
  getPaymentQRUrl(paymentId) {
    return `${this.#baseUrl}/payments/${paymentId}/qr`;
  }

  /**
   * Get payment QR code as binary image data
   *
   * Fetches the QR code image as binary data (ArrayBuffer).
   * Useful for server-side processing or saving to file.
   *
   * @param {string} paymentId - Payment ID
   * @returns {Promise<ArrayBuffer>} QR code image as binary data
   *
   * @example
   * // Get QR code as binary data
   * const imageData = await client.getPaymentQR('pay_abc123');
   * // Save to file (Node.js)
   * fs.writeFileSync('qr.png', Buffer.from(imageData));
   */
  async getPaymentQR(paymentId) {
    const url = `${this.#baseUrl}/payments/${paymentId}/qr`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.#timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.#apiKey}`,
        },
      });

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return response.arrayBuffer();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.#timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get exchange rates
   * @param {string} cryptocurrency - Cryptocurrency code
   * @param {string} [fiatCurrency] - Fiat currency code (default: USD)
   * @returns {Promise<Object>} Exchange rate
   */
  async getExchangeRate(cryptocurrency, fiatCurrency = 'USD') {
    return this.request(`/rates?crypto=${cryptocurrency}&fiat=${fiatCurrency}`);
  }

  /**
   * Convert fiat amount to cryptocurrency amount
   * @param {number} fiatAmount - Fiat amount to convert
   * @param {string} fiatCurrency - Fiat currency code (USD, EUR, etc.)
   * @param {string} cryptoCurrency - Cryptocurrency code (BTC, ETH, SOL, etc.)
   * @returns {Promise<Object>} { cryptoAmount, rate, fiat, crypto }
   * 
   * @example
   * const result = await client.convertFiatToCrypto(50, 'USD', 'SOL');
   * console.log(`$50 USD = ${result.cryptoAmount} SOL (rate: 1 SOL = $${result.rate})`);
   */
  async convertFiatToCrypto(fiatAmount, fiatCurrency, cryptoCurrency) {
    const rateData = await this.request(`/rates?coin=${cryptoCurrency}&fiat=${fiatCurrency}`);
    
    if (!rateData.success || !rateData.rate) {
      throw new Error(`Failed to get exchange rate for ${cryptoCurrency}/${fiatCurrency}`);
    }

    const cryptoAmount = fiatAmount / rateData.rate;
    
    return {
      cryptoAmount: cryptoAmount,
      rate: rateData.rate,
      fiat: fiatCurrency,
      crypto: cryptoCurrency
    };
  }

  /**
   * Get multiple exchange rates
   * @param {string[]} cryptocurrencies - Array of cryptocurrency codes
   * @param {string} [fiatCurrency] - Fiat currency code (default: USD)
   * @returns {Promise<Object>} Exchange rates
   */
  async getExchangeRates(cryptocurrencies, fiatCurrency = 'USD') {
    return this.request('/rates/batch', {
      method: 'POST',
      body: JSON.stringify({
        cryptocurrencies,
        fiatCurrency,
      }),
    });
  }

  /**
   * Get business details
   * @param {string} businessId - Business ID
   * @returns {Promise<Object>} Business details
   */
  async getBusiness(businessId) {
    return this.request(`/businesses/${businessId}`);
  }

  /**
   * List businesses
   * @returns {Promise<Object>} List of businesses
   */
  async listBusinesses() {
    return this.request('/businesses');
  }

  /**
   * Create a new business
   * @param {Object} params - Business parameters
   * @param {string} params.name - Business name
   * @param {string} [params.webhookUrl] - Webhook URL
   * @param {Object} [params.walletAddresses] - Wallet addresses by chain
   * @returns {Promise<Object>} Created business
   */
  async createBusiness({ name, webhookUrl, walletAddresses }) {
    return this.request('/businesses', {
      method: 'POST',
      body: JSON.stringify({
        name,
        webhookUrl,
        walletAddresses,
      }),
    });
  }

  /**
   * Update business
   * @param {string} businessId - Business ID
   * @param {Object} params - Update parameters
   * @returns {Promise<Object>} Updated business
   */
  async updateBusiness(businessId, params) {
    return this.request(`/businesses/${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get webhook logs
   * @param {string} businessId - Business ID
   * @param {number} [limit] - Number of results
   * @returns {Promise<Object>} Webhook logs
   */
  async getWebhookLogs(businessId, limit = 50) {
    return this.request(`/webhooks/logs?businessId=${businessId}&limit=${limit}`);
  }

  /**
   * Test webhook endpoint
   * @param {string} businessId - Business ID
   * @param {string} [eventType] - Event type to simulate
   * @returns {Promise<Object>} Test result
   */
  async testWebhook(businessId, eventType = 'payment.completed') {
    return this.request('/webhooks/test', {
      method: 'POST',
      body: JSON.stringify({
        businessId,
        eventType,
      }),
    });
  }

  // ── Escrow Methods ──────────────────────────────────────

  /**
   * Create a new escrow
   * @param {Object} params - See escrow.js createEscrow for full params
   * @returns {Promise<Object>} Created escrow with releaseToken
   */
  async createEscrow(params) {
    const { createEscrow } = await import('./escrow.js');
    return createEscrow(this, params);
  }

  /**
   * Get escrow status
   * @param {string} escrowId
   * @returns {Promise<Object>}
   */
  async getEscrow(escrowId) {
    const { getEscrow } = await import('./escrow.js');
    return getEscrow(this, escrowId);
  }

  /**
   * List escrows with filters
   * @param {Object} [filters]
   * @returns {Promise<Object>}
   */
  async listEscrows(filters) {
    const { listEscrows } = await import('./escrow.js');
    return listEscrows(this, filters);
  }

  /**
   * Release escrow funds to beneficiary
   * @param {string} escrowId
   * @param {string} releaseToken
   * @returns {Promise<Object>}
   */
  async releaseEscrow(escrowId, releaseToken) {
    const { releaseEscrow } = await import('./escrow.js');
    return releaseEscrow(this, escrowId, releaseToken);
  }

  /**
   * Refund escrow to depositor
   * @param {string} escrowId
   * @param {string} releaseToken
   * @returns {Promise<Object>}
   */
  async refundEscrow(escrowId, releaseToken) {
    const { refundEscrow } = await import('./escrow.js');
    return refundEscrow(this, escrowId, releaseToken);
  }

  /**
   * Dispute an escrow
   * @param {string} escrowId
   * @param {string} token - release_token or beneficiary_token
   * @param {string} reason - At least 10 characters
   * @returns {Promise<Object>}
   */
  async disputeEscrow(escrowId, token, reason) {
    const { disputeEscrow } = await import('./escrow.js');
    return disputeEscrow(this, escrowId, token, reason);
  }

  /**
   * Get escrow audit log
   * @param {string} escrowId
   * @returns {Promise<Array>}
   */
  async getEscrowEvents(escrowId) {
    const { getEscrowEvents } = await import('./escrow.js');
    return getEscrowEvents(this, escrowId);
  }

  /**
   * Poll escrow until target status
   * @param {string} escrowId
   * @param {Object} [options] - { targetStatus, intervalMs, timeoutMs }
   * @returns {Promise<Object>}
   */
  async waitForEscrow(escrowId, options) {
    const { waitForEscrow } = await import('./escrow.js');
    return waitForEscrow(this, escrowId, options);
  }

  /**
   * Authenticate with escrow using token
   * @param {string} escrowId - Escrow ID
   * @param {string} token - Release token or beneficiary token
   * @returns {Promise<Object>} { escrow, role }
   */
  async authenticateEscrow(escrowId, token) {
    const { authenticateEscrow } = await import('./escrow.js');
    return authenticateEscrow(this, escrowId, token);
  }

  // ── Stripe Payout Methods ───────────────────────────────

  /**
   * Create a payout to your connected Stripe account
   * 
   * @param {Object} params - Payout parameters
   * @param {number} params.amount - Amount in cents
   * @param {string} [params.currency='usd'] - Currency code
   * @param {string} [params.description] - Payout description
   * @param {Object} [params.metadata] - Custom metadata
   * @returns {Promise<Object>} Created payout
   */
  async createPayout(params) {
    const { createPayout } = await import('./payouts.js');
    return createPayout(this, params);
  }

  /**
   * List payouts
   * @param {Object} [filters] - Filter options
   * @returns {Promise<Object>} Payouts list with pagination
   */
  async listPayouts(filters) {
    const { listPayouts } = await import('./payouts.js');
    return listPayouts(this, filters);
  }

  /**
   * Get payout by ID
   * @param {string} payoutId - Payout ID
   * @returns {Promise<Object>} Payout details
   */
  async getPayout(payoutId) {
    const { getPayout } = await import('./payouts.js');
    return getPayout(this, payoutId);
  }

  // ── Stripe Card Payment Methods ────────────────────────

  /**
   * Create a card payment using Stripe
   * 
   * Creates a card payment session through Stripe Connect. Returns a checkout URL
   * that customers can use to pay with their credit/debit card.
   * 
   * @param {Object} params - Payment parameters
   * @param {string} params.businessId - Business ID (merchant must have completed Stripe onboarding)
   * @param {number} params.amount - Amount in cents (e.g., 5000 = $50.00)
   * @param {string} [params.currency='usd'] - Currency code (usd, eur, etc.)
   * @param {string} [params.description] - Payment description
   * @param {Object} [params.metadata] - Custom metadata
   * @param {string} [params.successUrl] - URL to redirect on successful payment
   * @param {string} [params.cancelUrl] - URL to redirect on payment cancellation
   * @param {boolean} [params.escrowMode=false] - Whether to use escrow mode (holds funds until release)
   * @returns {Promise<Object>} Payment session with checkout URL
   * 
   * @example
   * // Create a $50 card payment
   * const payment = await client.createCardPayment({
   *   businessId: 'your-business-id',
   *   amount: 5000, // $50.00 in cents
   *   currency: 'usd',
   *   description: 'Order #12345',
   *   metadata: { orderId: '12345' },
   *   successUrl: 'https://yourdomain.com/success',
   *   cancelUrl: 'https://yourdomain.com/cancel'
   * });
   * 
   * // Redirect customer to payment.checkout_url
   */
  async createCardPayment({
    businessId,
    amount,
    currency = 'usd',
    description,
    metadata,
    successUrl,
    cancelUrl,
    escrowMode = false
  }) {
    return this.request('/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId,
        amount,
        currency,
        description,
        metadata,
        successUrl,
        cancelUrl,
        escrowMode
      }),
    });
  }

  /**
   * Get Stripe account onboarding status
   * 
   * Checks whether a merchant has completed Stripe Connect onboarding
   * and is able to accept card payments.
   * 
   * @param {string} businessId - Business ID
   * @returns {Promise<Object>} Account status and capabilities
   * 
   * @example
   * const status = await client.getStripeAccountStatus('business-id');
   * if (status.onboarding_complete) {
   *   console.log('Merchant can accept card payments');
   * }
   */
  async getStripeAccountStatus(businessId) {
    return this.request(`/stripe/connect/status/${businessId}`);
  }

  /**
   * Create Stripe Connect onboarding link
   * 
   * Generates a Stripe Express onboarding link for a merchant.
   * The merchant must complete this onboarding before they can accept card payments.
   * 
   * @param {string} businessId - Business ID
   * @param {Object} [params] - Optional parameters
   * @param {string} [params.email] - Merchant email (pre-fills onboarding form)
   * @param {string} [params.country='US'] - Country code (US, CA, GB, etc.)
   * @returns {Promise<Object>} Onboarding link and account ID
   * 
   * @example
   * const onboarding = await client.createStripeOnboardingLink('business-id', {
   *   email: 'merchant@example.com',
   *   country: 'US'
   * });
   * 
   * // Redirect merchant to onboarding.onboarding_url
   */
  async createStripeOnboardingLink(businessId, params = {}) {
    return this.request('/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        businessId,
        ...params
      }),
    });
  }

  /**
   * Release card escrow funds to merchant
   * 
   * Releases funds held in card escrow mode to the merchant's Stripe account.
   * Only works for payments created with escrowMode: true.
   * 
   * @param {string} escrowId - Escrow ID (returned from escrow payment creation)
   * @param {string} [reason] - Reason for release
   * @returns {Promise<Object>} Release confirmation with transfer details
   * 
   * @example
   * const release = await client.releaseCardEscrow('escrow-id', 'Work completed');
   * console.log(`Released $${release.amount_transferred / 100} to merchant`);
   */
  async releaseCardEscrow(escrowId, reason) {
    return this.request('/stripe/escrow/release', {
      method: 'POST',
      body: JSON.stringify({
        escrowId,
        reason
      }),
    });
  }

  /**
   * Refund a card payment
   * 
   * Creates a refund for a card payment. Works for both gateway and escrow mode payments.
   * For escrow payments, refunds from held funds. For gateway payments, refunds from merchant account.
   * 
   * @param {string} paymentId - Payment intent ID or escrow ID
   * @param {Object} [params] - Optional parameters
   * @param {number} [params.amount] - Refund amount in cents (partial refund). Omit for full refund.
   * @param {string} [params.reason] - Reason for refund
   * @returns {Promise<Object>} Refund confirmation
   * 
   * @example
   * // Full refund
   * const refund = await client.refundCardPayment('payment-id');
   * 
   * // Partial refund
   * const partialRefund = await client.refundCardPayment('payment-id', {
   *   amount: 2500, // $25.00 refund
   *   reason: 'Customer complaint'
   * });
   */
  async refundCardPayment(paymentId, params = {}) {
    return this.request('/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({
        escrowId: paymentId, // API expects escrowId param
        ...params
      }),
    });
  }
}

export default CoinPayClient;