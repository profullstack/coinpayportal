/**
 * CoinPay API Client
 * Main client class for interacting with the CoinPay API
 */

const DEFAULT_BASE_URL = 'https://coinpay.dev/api';

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
   * @param {string} [options.baseUrl] - API base URL (default: https://coinpay.dev/api)
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
          'X-API-Key': this.#apiKey,
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
   * @param {Object} params - Payment parameters
   * @param {string} params.businessId - Business ID
   * @param {number} params.amount - Amount in fiat currency
   * @param {string} params.currency - Fiat currency code (USD, EUR, etc.)
   * @param {string} params.cryptocurrency - Cryptocurrency code (BTC, ETH, etc.)
   * @param {string} [params.description] - Payment description
   * @param {string} [params.metadata] - Custom metadata (JSON string)
   * @param {string} [params.callbackUrl] - Webhook callback URL
   * @returns {Promise<Object>} Created payment
   */
  async createPayment({
    businessId,
    amount,
    currency,
    cryptocurrency,
    description,
    metadata,
    callbackUrl,
  }) {
    return this.request('/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId,
        amount,
        currency,
        cryptocurrency,
        description,
        metadata,
        callbackUrl,
      }),
    });
  }

  /**
   * Get payment by ID
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} Payment details
   */
  async getPayment(paymentId) {
    return this.request(`/payments/${paymentId}`);
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
   * Get payment QR code
   * @param {string} paymentId - Payment ID
   * @param {string} [format] - QR code format (png, svg)
   * @returns {Promise<Object>} QR code data
   */
  async getPaymentQR(paymentId, format = 'png') {
    return this.request(`/payments/${paymentId}/qr?format=${format}`);
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
}

export default CoinPayClient;