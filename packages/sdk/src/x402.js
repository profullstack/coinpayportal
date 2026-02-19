/**
 * x402 Payment Protocol Support
 * 
 * CoinPayPortal as the first multi-chain, multi-asset x402 facilitator.
 * Supports native crypto (BTC, ETH, SOL, POL, BCH), USDC stablecoins,
 * Lightning (BOLT12), and Stripe fiat — all via HTTP 402.
 * 
 * @module x402
 */

/**
 * All supported payment methods with their network/asset metadata.
 * 
 * Each entry defines a scheme the facilitator can advertise in the
 * 402 `accepts` array, letting the buyer choose their preferred method.
 */
export const PAYMENT_METHODS = {
  // ── Native crypto ──────────────────────────────────────────────
  btc: {
    network: 'bitcoin',
    asset: 'BTC',
    scheme: 'exact',
    decimals: 8,
    label: 'Bitcoin',
  },
  bch: {
    network: 'bitcoin-cash',
    asset: 'BCH',
    scheme: 'exact',
    decimals: 8,
    label: 'Bitcoin Cash',
  },
  eth: {
    network: 'ethereum',
    asset: 'ETH',
    scheme: 'exact',
    decimals: 18,
    chainId: 1,
    label: 'Ethereum',
  },
  pol: {
    network: 'polygon',
    asset: 'POL',
    scheme: 'exact',
    decimals: 18,
    chainId: 137,
    label: 'Polygon',
  },
  sol: {
    network: 'solana',
    asset: 'SOL',
    scheme: 'exact',
    decimals: 9,
    label: 'Solana',
  },

  // ── USDC stablecoins ──────────────────────────────────────────
  usdc_eth: {
    network: 'ethereum',
    asset: 'USDC',
    scheme: 'exact',
    decimals: 6,
    chainId: 1,
    contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    label: 'USDC on Ethereum',
  },
  usdc_polygon: {
    network: 'polygon',
    asset: 'USDC',
    scheme: 'exact',
    decimals: 6,
    chainId: 137,
    contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    label: 'USDC on Polygon',
  },
  usdc_solana: {
    network: 'solana',
    asset: 'USDC',
    scheme: 'exact',
    decimals: 6,
    contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    label: 'USDC on Solana',
  },
  usdc_base: {
    network: 'base',
    asset: 'USDC',
    scheme: 'exact',
    decimals: 6,
    chainId: 8453,
    contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    label: 'USDC on Base',
  },

  // ── Lightning ──────────────────────────────────────────────────
  lightning: {
    network: 'lightning',
    asset: 'BTC',
    scheme: 'bolt12',
    decimals: 0, // sats
    label: 'Lightning (BOLT12)',
  },

  // ── Fiat via Stripe ────────────────────────────────────────────
  stripe: {
    network: 'stripe',
    asset: 'USD',
    scheme: 'stripe-checkout',
    decimals: 2,
    label: 'Card (Stripe)',
  },
};

/**
 * USDC contract addresses by network (convenience re-export)
 */
export const USDC_CONTRACTS = {
  base: PAYMENT_METHODS.usdc_base.contractAddress,
  ethereum: PAYMENT_METHODS.usdc_eth.contractAddress,
  polygon: PAYMENT_METHODS.usdc_polygon.contractAddress,
  solana: PAYMENT_METHODS.usdc_solana.contractAddress,
};

/**
 * Chain IDs for EVM networks
 */
export const CHAIN_IDS = {
  base: 8453,
  ethereum: 1,
  polygon: 137,
};

/**
 * Default facilitator URL
 */
const DEFAULT_FACILITATOR_URL = 'https://coinpayportal.com/api/x402';

/**
 * x402 protocol version
 */
const X402_VERSION = 1;

/**
 * All payment method keys
 */
const ALL_METHOD_KEYS = Object.keys(PAYMENT_METHODS);

/**
 * Convert a fiat amount (USD cents or dollars) to the smallest unit for a
 * given payment method, using a rates lookup.
 * 
 * @param {number} amountUsd - Amount in USD (e.g. 1.00)
 * @param {string} methodKey - Key from PAYMENT_METHODS
 * @param {Object} rates - Map of asset→USD rate (e.g. { BTC: 65000, ETH: 3500 })
 * @returns {string} Amount in the asset's smallest unit
 */
export function convertUsdToAssetAmount(amountUsd, methodKey, rates = {}) {
  const method = PAYMENT_METHODS[methodKey];
  if (!method) throw new Error(`Unknown payment method: ${methodKey}`);

  if (method.asset === 'USD') {
    // Stripe: amount in cents
    return String(Math.round(amountUsd * 100));
  }
  if (method.asset === 'USDC') {
    // USDC: 6 decimals, 1:1 with USD
    return String(Math.round(amountUsd * 1e6));
  }

  const rate = rates[method.asset];
  if (!rate) throw new Error(`No exchange rate for ${method.asset}`);

  const assetAmount = amountUsd / rate;
  const smallest = Math.round(assetAmount * Math.pow(10, method.decimals));
  return String(smallest);
}

/**
 * Build a single `accepts` entry for a payment method.
 */
function buildAcceptEntry(methodKey, { payTo, amount, resource, description, mimeType, maxTimeoutSeconds, facilitatorUrl }) {
  const method = PAYMENT_METHODS[methodKey];
  if (!method) throw new Error(`Unknown payment method: ${methodKey}`);

  const entry = {
    scheme: method.scheme,
    network: method.network,
    asset: method.contractAddress || method.asset,
    maxAmountRequired: String(amount),
    resource: resource || '',
    description: description || 'Payment required',
    mimeType: mimeType || 'application/json',
    payTo,
    maxTimeoutSeconds: maxTimeoutSeconds || 300,
    extra: {
      facilitator: facilitatorUrl || DEFAULT_FACILITATOR_URL,
      methodKey,
      assetSymbol: method.asset,
      label: method.label,
    },
  };

  if (method.chainId) {
    entry.extra.chainId = method.chainId;
  }

  return entry;
}

/**
 * Build a 402 response payload advertising multiple payment options.
 * 
 * This is CoinPayPortal's key differentiator: the `accepts` array includes
 * every supported chain and asset, letting the buyer choose.
 * 
 * @param {Object} options
 * @param {string} options.payTo - Merchant wallet address (or object mapping network→address)
 * @param {number} options.amountUsd - Price in USD
 * @param {Object} [options.rates] - Exchange rates { BTC: 65000, ETH: 3500, ... }
 * @param {string[]} [options.methods] - Payment method keys to include (default: all)
 * @param {string} [options.resource] - Resource URL
 * @param {string} [options.description] - Human-readable description
 * @param {string} [options.mimeType='application/json'] - Response MIME type
 * @param {number} [options.maxTimeoutSeconds=300] - Payment timeout
 * @param {string} [options.facilitatorUrl] - Custom facilitator URL
 * @returns {Object} x402 payment required response body
 * 
 * @example
 * // Advertise all methods
 * const body = buildPaymentRequired({
 *   payTo: { ethereum: '0x...', bitcoin: 'bc1...', solana: 'So1...' },
 *   amountUsd: 5.00,
 *   rates: { BTC: 65000, ETH: 3500, SOL: 150, POL: 0.50, BCH: 350 },
 * });
 * 
 * @example
 * // Only accept USDC and Lightning
 * const body = buildPaymentRequired({
 *   payTo: '0xMyWallet',
 *   amountUsd: 1.00,
 *   methods: ['usdc_eth', 'usdc_polygon', 'usdc_base', 'lightning'],
 * });
 */
export function buildPaymentRequired(options) {
  const {
    payTo,
    amountUsd,
    amount,        // legacy: raw amount for a single method
    network,       // legacy: single network
    rates = {},
    methods,
    resource,
    description = 'Payment required',
    mimeType = 'application/json',
    maxTimeoutSeconds = 300,
    facilitatorUrl = DEFAULT_FACILITATOR_URL,
  } = options;

  // Legacy single-method mode (backwards compatible)
  if (network && amount && !methods) {
    const methodKey = _networkToMethodKey(network);
    const addr = typeof payTo === 'object' ? (payTo[network] || Object.values(payTo)[0]) : payTo;
    return {
      x402Version: X402_VERSION,
      accepts: [buildAcceptEntry(methodKey, {
        payTo: addr, amount, resource, description, mimeType, maxTimeoutSeconds, facilitatorUrl,
      })],
    };
  }

  // Multi-method mode
  const methodKeys = methods || ALL_METHOD_KEYS;
  const accepts = [];

  for (const key of methodKeys) {
    const method = PAYMENT_METHODS[key];
    if (!method) continue;

    // Resolve pay-to address for this network
    let addr;
    if (typeof payTo === 'object') {
      addr = payTo[method.network] || payTo[key];
    } else {
      addr = payTo;
    }
    if (!addr) continue; // skip methods where merchant has no address

    // Convert USD to asset amount
    let assetAmount;
    try {
      if (amountUsd != null) {
        assetAmount = convertUsdToAssetAmount(amountUsd, key, rates);
      } else if (amount) {
        assetAmount = String(amount);
      } else {
        continue;
      }
    } catch {
      // No rate available for this asset — skip it
      continue;
    }

    accepts.push(buildAcceptEntry(key, {
      payTo: addr, amount: assetAmount, resource, description, mimeType, maxTimeoutSeconds, facilitatorUrl,
    }));
  }

  if (accepts.length === 0) {
    throw new Error('No payment methods could be built. Check payTo addresses and rates.');
  }

  return {
    x402Version: X402_VERSION,
    accepts,
  };
}

/**
 * Map a simple network name to the best-guess method key (legacy compat).
 */
function _networkToMethodKey(network) {
  const map = {
    base: 'usdc_base',
    ethereum: 'eth',
    polygon: 'pol',
    solana: 'sol',
    bitcoin: 'btc',
    'bitcoin-cash': 'bch',
    lightning: 'lightning',
    stripe: 'stripe',
  };
  return map[network] || network;
}

/**
 * Create Express/Next.js middleware that gates routes behind x402 payments.
 * 
 * Returns a function that accepts per-route options and returns middleware.
 * The 402 response advertises ALL supported payment methods by default.
 * 
 * @param {Object} globalOptions
 * @param {string} globalOptions.apiKey - CoinPayPortal API key
 * @param {string|Object} globalOptions.payTo - Wallet address(es): string or { network: address }
 * @param {string[]} [globalOptions.methods] - Payment methods to accept (default: all with addresses)
 * @param {Object} [globalOptions.rates] - Exchange rates { BTC: 65000, ... }
 * @param {string} [globalOptions.ratesEndpoint] - URL to fetch live rates (polled periodically)
 * @param {string} [globalOptions.description='Payment required'] - Default description
 * @param {string} [globalOptions.facilitatorUrl] - Custom facilitator URL
 * @param {string} [globalOptions.apiBaseUrl='https://coinpayportal.com'] - CoinPayPortal API base
 * @returns {Function} Middleware factory: (routeOptions) => middleware
 * 
 * @example
 * const x402 = createX402Middleware({
 *   apiKey: 'cp_live_xxxxx',
 *   payTo: {
 *     ethereum: '0xAbC...',
 *     bitcoin: 'bc1q...',
 *     solana: 'So1...',
 *     lightning: 'lno1...',
 *     stripe: 'acct_xxx',
 *   },
 *   rates: { BTC: 65000, ETH: 3500, SOL: 150, POL: 0.50, BCH: 350 },
 * });
 * 
 * // Charge $5 for premium access — buyer picks their chain
 * app.get('/premium', x402({ amountUsd: 5.00 }), handler);
 */
export function createX402Middleware(globalOptions) {
  const {
    apiKey,
    payTo,
    methods,
    rates = {},
    description = 'Payment required',
    facilitatorUrl = DEFAULT_FACILITATOR_URL,
    apiBaseUrl = 'https://coinpayportal.com',
  } = globalOptions;

  if (!apiKey) throw new Error('x402 middleware requires an apiKey');
  if (!payTo) throw new Error('x402 middleware requires a payTo address');

  // Mutable rates cache — can be updated externally or via ratesEndpoint
  let currentRates = { ...rates };

  // If ratesEndpoint provided, poll for fresh rates
  if (globalOptions.ratesEndpoint) {
    const fetchRates = async () => {
      try {
        const res = await fetch(globalOptions.ratesEndpoint);
        if (res.ok) currentRates = await res.json();
      } catch { /* ignore */ }
    };
    fetchRates();
    setInterval(fetchRates, 60_000); // refresh every 60s
  }

  /**
   * Route-level middleware factory.
   * 
   * @param {Object} routeOptions
   * @param {number} [routeOptions.amountUsd] - Price in USD (preferred)
   * @param {string} [routeOptions.amount] - Raw amount (legacy, single-method)
   * @param {string} [routeOptions.network] - Single network (legacy)
   * @param {string[]} [routeOptions.methods] - Override accepted methods for this route
   * @param {string} [routeOptions.description] - Route-specific description
   */
  return function x402Route(routeOptions = {}) {
    const routeAmountUsd = routeOptions.amountUsd;
    const routeAmount = routeOptions.amount;
    const routeDescription = routeOptions.description || description;
    const routeMethods = routeOptions.methods || methods;

    if (!routeAmountUsd && !routeAmount) {
      throw new Error('x402 route requires amountUsd or amount');
    }

    return async function x402Middleware(req, res, next) {
      const paymentHeader = req.headers['x-payment'] || req.headers['X-Payment'];

      if (!paymentHeader) {
        const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        try {
          const body = buildPaymentRequired({
            payTo,
            amountUsd: routeAmountUsd,
            amount: routeAmount,
            network: routeOptions.network,
            rates: currentRates,
            methods: routeMethods,
            resource,
            description: routeDescription,
            facilitatorUrl,
          });
          return res.status(402).json(body);
        } catch (err) {
          return res.status(500).json({ error: 'Failed to build payment options', details: err.message });
        }
      }

      // Verify the payment
      try {
        const result = await verifyX402Payment(paymentHeader, {
          apiKey,
          apiBaseUrl,
        });

        if (!result.valid) {
          return res.status(402).json({
            error: 'Invalid payment proof',
            details: result.reason,
          });
        }

        // Attach payment info to request for downstream use
        req.x402Payment = result.payment;
        next();
      } catch (err) {
        return res.status(500).json({ error: 'Payment verification failed', details: err.message });
      }
    };
  };
}

/**
 * Verify an x402 payment proof.
 * 
 * Calls CoinPayPortal's facilitator API to validate the cryptographic
 * signature and payment details in the X-PAYMENT header.
 * Supports all payment schemes: EVM signatures, BTC/BCH tx proofs,
 * Solana tx proofs, Lightning preimages, and Stripe payment intents.
 * 
 * @param {string} paymentHeader - The X-PAYMENT header value (base64-encoded JSON)
 * @param {Object} options
 * @param {string} options.apiKey - CoinPayPortal API key
 * @param {string} [options.apiBaseUrl='https://coinpayportal.com'] - API base URL
 * @returns {Promise<{valid: boolean, payment?: Object, reason?: string}>}
 */
export async function verifyX402Payment(paymentHeader, options = {}) {
  const { apiKey, apiBaseUrl = 'https://coinpayportal.com' } = options;

  if (!paymentHeader) {
    return { valid: false, reason: 'Missing payment header' };
  }

  // Decode the payment header
  let payment;
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
    payment = JSON.parse(decoded);
  } catch {
    return { valid: false, reason: 'Invalid payment header encoding' };
  }

  // Validate required fields
  if (!payment.scheme && !payment.signature && !payment.payload) {
    return { valid: false, reason: 'Missing scheme, signature, or payload in payment proof' };
  }

  // Check expiry if present
  if (payment.payload?.expiresAt) {
    const expiresAt = typeof payment.payload.expiresAt === 'number'
      ? new Date(payment.payload.expiresAt * 1000)
      : new Date(payment.payload.expiresAt);
    if (expiresAt < new Date()) {
      return { valid: false, reason: 'Payment proof has expired' };
    }
  }

  // Call CoinPayPortal facilitator to verify
  try {
    const response = await fetch(`${apiBaseUrl}/api/x402/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ payment }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { valid: false, reason: data.error || 'Verification failed' };
    }

    return { valid: true, payment: data.payment };
  } catch (err) {
    return { valid: false, reason: `Facilitator error: ${err.message}` };
  }
}

/**
 * Settle an x402 payment on-chain (or via the appropriate payment rail).
 * 
 * For crypto: claims the payment on-chain.
 * For Lightning: confirms the preimage.
 * For Stripe: captures the payment intent.
 * 
 * @param {string} paymentHeader - The X-PAYMENT header value (base64-encoded JSON)
 * @param {Object} options
 * @param {string} options.apiKey - CoinPayPortal API key
 * @param {string} [options.apiBaseUrl='https://coinpayportal.com'] - API base URL
 * @returns {Promise<{settled: boolean, txHash?: string, network?: string, error?: string}>}
 */
export async function settleX402Payment(paymentHeader, options = {}) {
  const { apiKey, apiBaseUrl = 'https://coinpayportal.com' } = options;

  if (!paymentHeader) {
    return { settled: false, error: 'Missing payment header' };
  }

  let payment;
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
    payment = JSON.parse(decoded);
  } catch {
    return { settled: false, error: 'Invalid payment header encoding' };
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/x402/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ payment }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { settled: false, error: data.error || 'Settlement failed' };
    }

    return {
      settled: true,
      txHash: data.txHash,
      network: data.network,
      asset: data.asset,
      method: data.method,
    };
  } catch (err) {
    return { settled: false, error: `Settlement error: ${err.message}` };
  }
}
