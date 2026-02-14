/**
 * Lightning Module for CoinPay SDK
 *
 * Manages BOLT12 Lightning Network operations: node provisioning,
 * offer creation, and payment tracking.
 */

const DEFAULT_BASE_URL = 'https://coinpayportal.com/api';

/**
 * Lightning client for BOLT12 operations
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
  // Nodes
  // ──────────────────────────────────────────────

  /**
   * Provision a Greenlight CLN node for a wallet.
   * @param {Object} params
   * @param {string} params.wallet_id - Wallet UUID
   * @param {string} params.mnemonic - BIP39 mnemonic (used server-side to derive LN keys)
   * @param {string} [params.business_id] - Optional business UUID
   * @returns {Promise<Object>} The provisioned node
   */
  async provisionNode({ wallet_id, mnemonic, business_id }) {
    return this.#client.request('/lightning/nodes', {
      method: 'POST',
      body: JSON.stringify({ wallet_id, mnemonic, business_id }),
    });
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
  // Offers
  // ──────────────────────────────────────────────

  /**
   * Create a BOLT12 offer.
   * @param {Object} params
   * @param {string} params.node_id - Node UUID
   * @param {string} params.description - Human-readable description
   * @param {number} [params.amount_msat] - Fixed amount in millisatoshis (omit for any-amount)
   * @param {string} [params.currency] - Currency code (default: "BTC")
   * @param {string} [params.business_id] - Optional business UUID
   * @returns {Promise<Object>}
   */
  async createOffer({ node_id, description, amount_msat, currency, business_id }) {
    return this.#client.request('/lightning/offers', {
      method: 'POST',
      body: JSON.stringify({ node_id, description, amount_msat, currency, business_id }),
    });
  }

  /**
   * Get offer by ID.
   * @param {string} offerId
   * @returns {Promise<Object>} Includes offer and qr_uri
   */
  async getOffer(offerId) {
    return this.#client.request(`/lightning/offers/${offerId}`);
  }

  /**
   * List offers with optional filters.
   * @param {Object} [params]
   * @param {string} [params.business_id]
   * @param {string} [params.node_id]
   * @param {string} [params.status] - "active" | "disabled" | "archived"
   * @param {number} [params.limit] - Default 20
   * @param {number} [params.offset] - Default 0
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
   * List Lightning payments.
   * @param {Object} [params]
   * @param {string} [params.business_id]
   * @param {string} [params.node_id]
   * @param {string} [params.offer_id]
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
   * Send a payment to a BOLT12 offer or invoice.
   * @param {Object} params
   * @param {string} params.node_id - Node UUID
   * @param {string} params.bolt12 - BOLT12 offer or invoice string
   * @param {number} params.amount_sats - Amount in satoshis
   * @returns {Promise<Object>}
   */
  async sendPayment({ node_id, bolt12, amount_sats }) {
    return this.#client.request('/lightning/payments', {
      method: 'POST',
      body: JSON.stringify({ node_id, bolt12, amount_sats }),
    });
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
