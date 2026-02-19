/**
 * x402 Payment Protocol Support
 * 
 * CoinPayPortal as a multi-chain x402 facilitator.
 * Enables HTTP 402-based payments with USDC across Base, Ethereum, Polygon, and Solana.
 * 
 * @module x402
 */

/**
 * USDC contract addresses by network
 */
export const USDC_CONTRACTS = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
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
 * Build a 402 response payload for a given resource.
 * 
 * @param {Object} options
 * @param {string} options.payTo - Merchant wallet address
 * @param {string} options.amount - Amount in USDC smallest unit (e.g., "1000000" = 1 USDC)
 * @param {string} [options.network='base'] - Network: 'base', 'ethereum', 'polygon', 'solana'
 * @param {string} [options.resource] - Resource URL being paid for
 * @param {string} [options.description] - Human-readable description
 * @param {string} [options.mimeType='application/json'] - Expected response MIME type
 * @param {number} [options.maxTimeoutSeconds=300] - Payment timeout
 * @param {string} [options.facilitatorUrl] - Custom facilitator URL
 * @returns {Object} x402 payment required response body
 */
export function buildPaymentRequired(options) {
  const {
    payTo,
    amount,
    network = 'base',
    resource,
    description = 'Payment required',
    mimeType = 'application/json',
    maxTimeoutSeconds = 300,
    facilitatorUrl = DEFAULT_FACILITATOR_URL,
  } = options;

  const asset = USDC_CONTRACTS[network];
  if (!asset) {
    throw new Error(`Unsupported network: ${network}. Supported: ${Object.keys(USDC_CONTRACTS).join(', ')}`);
  }

  return {
    x402Version: X402_VERSION,
    accepts: [{
      scheme: 'exact',
      network,
      maxAmountRequired: String(amount),
      resource: resource || '',
      description,
      mimeType,
      payTo,
      maxTimeoutSeconds,
      asset,
      extra: {
        facilitator: facilitatorUrl,
        chainId: CHAIN_IDS[network] || null,
      },
    }],
  };
}

/**
 * Create Express/Next.js middleware that gates routes behind x402 payments.
 * 
 * Returns a function that accepts per-route options (amount, description, etc.)
 * and returns middleware.
 * 
 * @param {Object} globalOptions
 * @param {string} globalOptions.apiKey - CoinPayPortal API key
 * @param {string} globalOptions.payTo - Merchant wallet address
 * @param {string} [globalOptions.network='base'] - Default network
 * @param {string} [globalOptions.description='Payment required'] - Default description
 * @param {string} [globalOptions.facilitatorUrl] - Custom facilitator URL
 * @param {string} [globalOptions.apiBaseUrl='https://coinpayportal.com'] - CoinPayPortal API base
 * @returns {Function} Middleware factory: (routeOptions) => middleware
 * 
 * @example
 * const x402 = createX402Middleware({
 *   apiKey: 'cp_live_xxxxx',
 *   payTo: '0xYourWallet',
 * });
 * 
 * app.get('/premium', x402({ amount: '1000000' }), handler);
 */
export function createX402Middleware(globalOptions) {
  const {
    apiKey,
    payTo,
    network = 'base',
    description = 'Payment required',
    facilitatorUrl = DEFAULT_FACILITATOR_URL,
    apiBaseUrl = 'https://coinpayportal.com',
  } = globalOptions;

  if (!apiKey) throw new Error('x402 middleware requires an apiKey');
  if (!payTo) throw new Error('x402 middleware requires a payTo address');

  return function x402Route(routeOptions = {}) {
    const routeAmount = routeOptions.amount;
    const routeDescription = routeOptions.description || description;
    const routeNetwork = routeOptions.network || network;

    if (!routeAmount) throw new Error('x402 route requires an amount');

    return async function x402Middleware(req, res, next) {
      const paymentHeader = req.headers['x-payment'] || req.headers['X-Payment'];

      if (!paymentHeader) {
        const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const body = buildPaymentRequired({
          payTo,
          amount: routeAmount,
          network: routeNetwork,
          resource,
          description: routeDescription,
          facilitatorUrl,
        });
        return res.status(402).json(body);
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
 * 
 * @param {string} paymentHeader - The X-PAYMENT header value (base64-encoded JSON)
 * @param {Object} options
 * @param {string} options.apiKey - CoinPayPortal API key
 * @param {string} [options.apiBaseUrl='https://coinpayportal.com'] - API base URL
 * @returns {Promise<{valid: boolean, payment?: Object, reason?: string}>}
 * 
 * @example
 * const result = await verifyX402Payment(header, { apiKey: 'cp_live_xxxxx' });
 * if (result.valid) {
 *   // Payment is valid, serve the resource
 * }
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
  if (!payment.signature || !payment.payload) {
    return { valid: false, reason: 'Missing signature or payload in payment proof' };
  }

  // Check expiry
  if (payment.payload.expiresAt) {
    const expiresAt = new Date(payment.payload.expiresAt);
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
 * Settle an x402 payment on-chain.
 * 
 * Calls CoinPayPortal's facilitator to claim the USDC payment
 * and transfer it to the merchant's wallet.
 * 
 * @param {string} paymentHeader - The X-PAYMENT header value (base64-encoded JSON)
 * @param {Object} options
 * @param {string} options.apiKey - CoinPayPortal API key
 * @param {string} [options.apiBaseUrl='https://coinpayportal.com'] - API base URL
 * @returns {Promise<{settled: boolean, txHash?: string, error?: string}>}
 * 
 * @example
 * const result = await settleX402Payment(header, { apiKey: 'cp_live_xxxxx' });
 * if (result.settled) {
 *   console.log('Settlement tx:', result.txHash);
 * }
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

    return { settled: true, txHash: data.txHash, network: data.network };
  } catch (err) {
    return { settled: false, error: `Settlement error: ${err.message}` };
  }
}
