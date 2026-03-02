/**
 * Lightning Module for CoinPay SDK
 *
 * Manages Lightning Network operations: wallet provisioning (via LNbits),
 * lightning address registration, invoice creation, payment sending, and history.
 *
 * Lightning wallets are custodial — funds are held on CoinPay's server.
 */

/**
 * Lightning client for LN operations
 */
export class LightningClient {
  #client;

  /**
   * @param {import('./client.js').CoinPayClient} client - Parent CoinPay client
   */
  constructor(client) {
    this.#client = client;
  }

  // ──────────────────────────────────────────────
  // Nodes / Wallet Provisioning
  // ──────────────────────────────────────────────

  /**
   * Enable Lightning for a wallet (provisions an LNbits custodial wallet).
   * @param {Object} params
   * @param {string} params.wallet_id - Wallet UUID
   * @param {string} params.mnemonic - BIP39 mnemonic
   * @param {string} [params.business_id] - Optional business UUID
   * @returns {Promise<Object>} The provisioned node record
   */
  async enableWallet({ wallet_id, mnemonic, business_id }) {
    return this.#client.request('/lightning/nodes', {
      method: 'POST',
      body: JSON.stringify({ wallet_id, mnemonic, business_id }),
    });
  }

  /**
   * @deprecated Use enableWallet() instead
   */
  async provisionNode(params) {
    return this.enableWallet(params);
  }

  /**
   * Get node status by ID.
   * @param {string} nodeId
   * @returns {Promise<Object>}
   */
  async getNode(nodeId) {
    return this.#client.request(`/lightning/nodes/${nodeId}`);
  }

  /**
   * Get node by wallet ID.
   * @param {string} walletId - Wallet UUID
   * @returns {Promise<Object>}
   */
  async getNodeByWallet(walletId) {
    return this.#client.request(`/lightning/nodes?wallet_id=${walletId}`);
  }

  // ──────────────────────────────────────────────
  // Lightning Address
  // ──────────────────────────────────────────────

  /**
   * Register a Lightning Address (username@coinpayportal.com).
   * Requires Lightning to be enabled first.
   * @param {Object} params
   * @param {string} params.wallet_id - Wallet UUID
   * @param {string} params.username - Desired username (3-32 chars, lowercase alphanumeric)
   * @returns {Promise<Object>} { lightning_address, username }
   */
  async registerAddress({ wallet_id, username }) {
    return this.#client.request('/lightning/address', {
      method: 'POST',
      body: JSON.stringify({ wallet_id, username }),
    });
  }

  /**
   * Get Lightning Address for a wallet.
   * @param {string} walletId - Wallet UUID
   * @returns {Promise<Object>} { lightning_address, username } or { lightning_address: null }
   */
  async getAddress(walletId) {
    return this.#client.request(`/lightning/address?wallet_id=${walletId}`);
  }

  /**
   * Check if a Lightning Address username is available.
   * @param {string} username
   * @returns {Promise<Object>} { available: boolean }
   */
  async checkAddressAvailable(username) {
    return this.#client.request(`/lightning/address?username=${encodeURIComponent(username)}`);
  }

  // ──────────────────────────────────────────────
  // Invoices
  // ──────────────────────────────────────────────

  /**
   * Create a BOLT11 invoice to receive a payment.
   * @param {Object} params
   * @param {string} params.wallet_id - Wallet UUID
   * @param {number} params.amount_sats - Amount in satoshis
   * @param {string} [params.description] - Invoice description/memo
   * @returns {Promise<Object>} { payment_request, payment_hash, ... }
   */
  async createInvoice({ wallet_id, amount_sats, description }) {
    return this.#client.request('/lightning/invoices', {
      method: 'POST',
      body: JSON.stringify({ wallet_id, amount_sats, description }),
    });
  }

  // ──────────────────────────────────────────────
  // Offers (BOLT12) — currently not supported
  // ──────────────────────────────────────────────

  /**
   * Create a BOLT12 offer.
   * @deprecated BOLT12 offers are not currently supported (LNbits limitation).
   * Use createInvoice() or registerAddress() instead.
   */
  async createOffer(params) {
    return this.#client.request('/lightning/offers', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get offer by ID.
   * @param {string} offerId
   * @returns {Promise<Object>}
   */
  async getOffer(offerId) {
    return this.#client.request(`/lightning/offers/${offerId}`);
  }

  /**
   * List offers with optional filters.
   * @param {Object} [params]
   * @param {string} [params.business_id]
   * @param {string} [params.node_id]
   * @param {string} [params.status]
   * @param {number} [params.limit]
   * @param {number} [params.offset]
   * @returns {Promise<Object>} { offers, total, limit, offset }
   */
  async listOffers(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    return this.#client.request(`/lightning/offers?${qs}`);
  }

  // ──────────────────────────────────────────────
  // Payments
  // ──────────────────────────────────────────────

  /**
   * Send a Lightning payment. Accepts:
   * - BOLT11 invoice string
   * - Lightning address (user@domain)
   * @param {Object} params
   * @param {string} params.wallet_id - Wallet UUID
   * @param {string} params.destination - BOLT11 invoice or lightning address (user@domain)
   * @param {number} [params.amount_sats] - Amount in satoshis (required for lightning addresses, optional for invoices with amount)
   * @returns {Promise<Object>} { payment_hash, status }
   */
  async sendPayment({ wallet_id, destination, amount_sats }) {
    return this.#client.request('/lightning/payments', {
      method: 'POST',
      body: JSON.stringify({ wallet_id, bolt12: destination, amount_sats }),
    });
  }

  /**
   * List Lightning payments.
   * @param {Object} [params]
   * @param {string} [params.wallet_id]
   * @param {string} [params.business_id]
   * @param {string} [params.node_id]
   * @param {string} [params.offer_id]
   * @param {string} [params.direction] - "incoming" | "outgoing"
   * @param {string} [params.status] - "pending" | "settled" | "failed"
   * @param {number} [params.limit] - Default 50
   * @param {number} [params.offset] - Default 0
   * @returns {Promise<Object>} { payments, total, limit, offset }
   */
  async listPayments(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    return this.#client.request(`/lightning/payments?${qs}`);
  }

  /**
   * Get payment status by payment hash.
   * @param {string} paymentHash
   * @returns {Promise<Object>}
   */
  async getPayment(paymentHash) {
    return this.#client.request(`/lightning/payments/${paymentHash}`);
  }
}

export default LightningClient;
