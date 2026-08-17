/**
 * x402 Payment Protocol Support
 * 
 * CoinPayPortal as the first multi-chain, multi-asset x402 facilitator.
 * Supports native crypto (BTC, ETH, SOL, POL, BCH), USDC stablecoins,
 * Lightning (BOLT12), and Stripe fiat — all via HTTP 402.
 * 
 * @module x402
 */

import { buildPaymentRequiredV2 } from './x402-v2.js';

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
 * Decode an X-PAYMENT header without verifying it.
 *
 * Returns null on anything malformed — the caller treats that as "no usable
 * proof", and the facilitator remains the only thing that decides validity.
 */
function decodePaymentHeader(paymentHeader) {
  try {
    return JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Work out what this proof was supposed to pay, by finding the offer entry for
 * the method the payer chose.
 *
 * The price comes from the offer the server just built — never from the proof
 * itself, which is the payer's word for what they owe.
 *
 * @returns {{amount: string, resource: string, payTo?: string, asset?: string}|null}
 *   null if the proof matches no advertised method, in which case there is no
 *   price to hold it to.
 */
export function expectedForProof(paymentHeader, offer, resource) {
  const payment = decodePaymentHeader(paymentHeader);
  if (!payment?.payload) return null;

  // A v2 proof describes itself differently: the network sits at the top level
  // and the payload holds a signed authorization rather than loose fields.
  // Matching it against the offer the same way as v1 would find nothing and
  // report "no price to check against" for a perfectly good payment.
  const authorization = payment.payload.authorization;
  if (authorization) {
    const entries = offer?.accepts || [];
    const match =
      entries.find((e) => e.network === payment.network && e.payTo === authorization.to) ||
      entries.find((e) => e.network === payment.network);

    if (!match) return null;

    return {
      amount: match.amount ?? match.maxAmountRequired,
      resource,
      // v2 verification needs both: an EIP-3009 signature says nothing about
      // which token it is denominated in, so without the asset there is no
      // domain to check it against.
      payTo: match.payTo,
      asset: match.asset,
    };
  }

  const { network, asset } = payment.payload;
  const methodKey = payment.payload.methodKey || payment.payload.extra?.methodKey;

  const entries = offer?.accepts || [];

  // Prefer an exact method match: a network alone is ambiguous, since e.g.
  // ethereum offers both ETH and USDC at very different smallest-unit prices.
  let match = methodKey
    ? entries.find((e) => e.extra?.methodKey === methodKey)
    : undefined;

  if (!match && network) {
    const sameNetwork = entries.filter((e) => e.network === network);
    match =
      sameNetwork.find((e) => e.asset === asset) ||
      (sameNetwork.length === 1 ? sameNetwork[0] : undefined);
  }

  if (!match) return null;

  return { amount: match.maxAmountRequired, resource };
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
    allowPendingConfirmation: globalAllowPendingConfirmation = false,
    /**
     * Which protocol version to quote in the 402.
     *
     * Defaults to 1 so existing integrations keep the offer they have today —
     * their payers only understand our dialect, and switching the quote out
     * from under them would break every one at once. Set to 2 to advertise the
     * real protocol, which is what any standard wallet (MetaMask, Phantom) can
     * actually pay.
     */
    x402Version: protocolVersion = 1,
  } = globalOptions;

  if (!apiKey) throw new Error('x402 middleware requires an apiKey');
  if (protocolVersion !== 1 && protocolVersion !== 2) {
    throw new Error(`Unsupported x402Version: ${protocolVersion} (expected 1 or 2)`);
  }
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
    const allowPendingConfirmation =
      routeOptions.allowPendingConfirmation ?? globalAllowPendingConfirmation;

    if (!routeAmountUsd && !routeAmount) {
      throw new Error('x402 route requires amountUsd or amount');
    }

    return async function x402Middleware(req, res, next) {
      const paymentHeader = req.headers['x-payment'] || req.headers['X-Payment'];
      const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

      // Build the offer regardless of branch: on a 402 it is the response body,
      // and on a paid request it is the price the proof has to actually cover.
      let offer;
      try {
        offer =
          protocolVersion === 2
            ? buildPaymentRequiredV2({
                payTo,
                amountUsd: routeAmountUsd,
                amount: routeAmount,
                methods: routeMethods,
                resource,
                description: routeDescription,
              })
            : buildPaymentRequired({
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
      } catch (err) {
        return res.status(500).json({ error: 'Failed to build payment options', details: err.message });
      }

      if (!paymentHeader) {
        return res.status(402).json(offer);
      }

      // Verify the payment
      try {
        // Find the advertised price for the method the payer actually used.
        // Without this the facilitator has nothing to compare the proof
        // against, and any proof unlocks any priced route.
        const expected = expectedForProof(paymentHeader, offer, resource);
        if (!expected) {
          return res.status(402).json({
            error: 'Invalid payment proof',
            details: 'Proof does not correspond to any offered payment method',
          });
        }

        const result = await verifyX402Payment(paymentHeader, {
          apiKey,
          apiBaseUrl,
          expected,
        });

        if (!result.valid) {
          return res.status(402).json({
            error: 'Invalid payment proof',
            details: result.reason,
          });
        }

        // On non-EVM rails the paid amount is self-reported until settlement
        // confirms it on-chain, so serving now means serving on trust.
        if (result.payment?.pendingConfirmation && !allowPendingConfirmation) {
          return res.status(402).json({
            error: 'Payment not confirmed',
            details:
              'This payment cannot be confirmed until it settles on-chain. ' +
              'Set allowPendingConfirmation: true to serve on unconfirmed proofs.',
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
 * @param {{amount: string, resource: string}} options.expected - What this
 *   request is charging, and for what. Required: the facilitator refuses to
 *   verify a proof it cannot hold to a price.
 * @returns {Promise<{valid: boolean, payment?: Object, reason?: string}>}
 */
export async function verifyX402Payment(paymentHeader, options = {}) {
  const { apiKey, apiBaseUrl = 'https://coinpayportal.com', expected } = options;

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

  // A proof is only meaningful against a price. Without one there is nothing
  // to check it covers, which is exactly how a $0.01 proof used to unlock a
  // $5.00 resource.
  if (!expected?.amount || !expected?.resource) {
    return {
      valid: false,
      reason: 'Missing expected amount/resource — refusing to verify a proof with no price to check it against',
    };
  }

  // Call CoinPayPortal facilitator to verify
  try {
    const response = await fetch(`${apiBaseUrl}/api/x402/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ payment, expected }),
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
