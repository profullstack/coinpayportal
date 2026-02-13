/**
 * CoinPay Card Payments - Convenience functions for Stripe integration
 * 
 * This module provides high-level convenience functions for working with
 * card payments through Stripe Connect, similar to the payments.js module.
 */

/**
 * Quick card payment creation with sensible defaults
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} businessId - Business ID
 * @param {number} amountUSD - Amount in USD (will be converted to cents)
 * @param {string} description - Payment description
 * @param {Object} [options] - Additional options
 * @param {Object} [options.metadata] - Custom metadata
 * @param {string} [options.successUrl] - Success redirect URL
 * @param {string} [options.cancelUrl] - Cancel redirect URL
 * @param {boolean} [options.escrowMode=false] - Enable escrow mode
 * @returns {Promise<Object>} Payment session with checkout URL
 * 
 * @example
 * import { createQuickCardPayment } from '@profullstack/coinpay/card-payments';
 * 
 * const payment = await createQuickCardPayment(client, 'business-id', 50, 'Order #123', {
 *   metadata: { orderId: '123' },
 *   escrowMode: true
 * });
 * 
 * // Redirect customer to: payment.checkout_url
 */
export async function createQuickCardPayment(client, businessId, amountUSD, description, options = {}) {
  const {
    metadata = {},
    successUrl,
    cancelUrl,
    escrowMode = false,
  } = options;

  // Convert USD to cents
  const amountCents = Math.round(amountUSD * 100);

  return client.createCardPayment({
    businessId,
    amount: amountCents,
    currency: 'usd',
    description,
    metadata,
    successUrl,
    cancelUrl,
    escrowMode,
  });
}

/**
 * Wait for merchant to complete Stripe onboarding
 * 
 * Polls the Stripe account status until onboarding is complete.
 * Useful for integration flows where you need to wait for merchant setup.
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} businessId - Business ID
 * @param {Object} [options] - Polling options
 * @param {number} [options.intervalMs=5000] - Polling interval in ms
 * @param {number} [options.timeoutMs=300000] - Timeout in ms (default: 5 minutes)
 * @param {Function} [options.onStatusChange] - Callback for status changes
 * @returns {Promise<Object>} Final account status when onboarding complete
 * 
 * @example
 * const accountStatus = await waitForStripeOnboarding(client, 'business-id', {
 *   onStatusChange: (status) => {
 *     console.log(`Onboarding status: ${JSON.stringify(status)}`);
 *   }
 * });
 */
export async function waitForStripeOnboarding(client, businessId, options = {}) {
  const {
    intervalMs = 5000,
    timeoutMs = 300000, // 5 minutes
    onStatusChange,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await client.getStripeAccountStatus(businessId);

    if (onStatusChange) {
      onStatusChange(status);
    }

    if (status.onboarding_complete) {
      return status;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Stripe onboarding timeout after ${timeoutMs}ms`);
}

/**
 * Create payment with automatic merchant onboarding check
 * 
 * Checks if merchant has completed Stripe onboarding first, and provides
 * helpful error messages if not. Prevents failed payment attempts.
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {Object} params - Payment parameters (same as createCardPayment)
 * @returns {Promise<Object>} Payment session or onboarding info if incomplete
 * 
 * @example
 * const result = await createCardPaymentWithOnboardingCheck(client, {
 *   businessId: 'business-id',
 *   amount: 5000,
 *   description: 'Order #123'
 * });
 * 
 * if (result.requires_onboarding) {
 *   // Redirect merchant to result.onboarding_url
 * } else {
 *   // Redirect customer to result.checkout_url
 * }
 */
export async function createCardPaymentWithOnboardingCheck(client, params) {
  try {
    // Check onboarding status first
    const status = await client.getStripeAccountStatus(params.businessId);

    if (!status.onboarding_complete) {
      // Generate onboarding link if needed
      const onboarding = await client.createStripeOnboardingLink(params.businessId);
      
      return {
        requires_onboarding: true,
        onboarding_url: onboarding.onboarding_url,
        status: status,
        message: 'Merchant must complete Stripe onboarding before accepting card payments',
      };
    }

    // Onboarding complete, create payment
    const payment = await client.createCardPayment(params);
    return {
      requires_onboarding: false,
      ...payment,
    };

  } catch (error) {
    if (error.status === 404) {
      // No Stripe account exists, need onboarding
      const onboarding = await client.createStripeOnboardingLink(params.businessId);
      
      return {
        requires_onboarding: true,
        onboarding_url: onboarding.onboarding_url,
        status: null,
        message: 'Merchant needs to complete Stripe onboarding',
      };
    }
    throw error;
  }
}

/**
 * Get payment method support status
 * 
 * Returns which payment methods are available for a merchant.
 * Helps with conditional UI rendering.
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Available payment methods
 * 
 * @example
 * const support = await getPaymentMethodSupport(client, 'business-id');
 * console.log(support);
 * // {
 * //   crypto: true,
 * //   cards: true,
 * //   escrow: true,
 * //   stripe_onboarding_complete: true
 * // }
 */
export async function getPaymentMethodSupport(client, businessId) {
  try {
    // Check if business exists (crypto payments always work)
    await client.getBusiness(businessId);
    
    let cardSupport = false;
    let stripeOnboardingComplete = false;

    // Check Stripe status
    try {
      const stripeStatus = await client.getStripeAccountStatus(businessId);
      cardSupport = stripeStatus.onboarding_complete;
      stripeOnboardingComplete = stripeStatus.onboarding_complete;
    } catch (error) {
      // No Stripe account = no card support yet
      cardSupport = false;
      stripeOnboardingComplete = false;
    }

    return {
      crypto: true, // Always available
      cards: cardSupport,
      escrow: cardSupport, // Card escrow requires Stripe
      stripe_onboarding_complete: stripeOnboardingComplete,
    };

  } catch (error) {
    if (error.status === 404) {
      return {
        crypto: false,
        cards: false,
        escrow: false,
        stripe_onboarding_complete: false,
        error: 'Business not found',
      };
    }
    throw error;
  }
}

/**
 * Format amount for display
 * 
 * Converts cents to dollar amount with proper formatting.
 * 
 * @param {number} amountCents - Amount in cents
 * @param {string} [currency='USD'] - Currency code
 * @returns {string} Formatted amount string
 * 
 * @example
 * formatCardAmount(5000); // "$50.00"
 * formatCardAmount(5050); // "$50.50"
 * formatCardAmount(500, 'EUR'); // "€5.00"
 */
export function formatCardAmount(amountCents, currency = 'USD') {
  const amount = amountCents / 100;
  
  const formatters = {
    USD: (amt) => `$${amt.toFixed(2)}`,
    EUR: (amt) => `€${amt.toFixed(2)}`,
    GBP: (amt) => `£${amt.toFixed(2)}`,
    CAD: (amt) => `C$${amt.toFixed(2)}`,
  };

  const formatter = formatters[currency.toUpperCase()];
  if (formatter) {
    return formatter(amount);
  }

  // Fallback for unknown currencies
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

/**
 * Calculate platform fees for card payments
 * 
 * @param {number} amountCents - Payment amount in cents
 * @param {string} tier - Merchant tier ('free' or 'pro')
 * @returns {Object} Fee breakdown
 * 
 * @example
 * const fees = calculateCardPaymentFees(5000, 'free');
 * console.log(fees);
 * // {
 * //   amount: 5000,
 * //   platformFee: 50,
 * //   platformFeePercent: 1,
 * //   merchantReceives: 4950 // before Stripe fees
 * // }
 */
export function calculateCardPaymentFees(amountCents, tier = 'free') {
  const platformFeePercent = tier === 'pro' ? 0.5 : 1.0; // 0.5% or 1%
  const platformFeeCents = Math.round(amountCents * (platformFeePercent / 100));
  
  return {
    amount: amountCents,
    platformFee: platformFeeCents,
    platformFeePercent,
    merchantReceives: amountCents - platformFeeCents, // Before Stripe processing fees
  };
}

/**
 * Create a card escrow payment
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} businessId - Business ID
 * @param {number} amountUSD - Amount in USD (will be converted to cents)
 * @param {string} description - Payment description
 * @param {Object} [metadata={}] - Custom metadata
 * @returns {Promise<Object>} Escrow payment session with checkout URL
 * 
 * @example
 * import { createCardEscrow } from '@profullstack/coinpay/card-payments';
 * 
 * const escrow = await createCardEscrow(client, 'business-id', 100, 'Service payment', {
 *   orderId: '123',
 *   serviceType: 'web-design'
 * });
 * 
 * // Redirect customer to: escrow.checkout_url
 */
export async function createCardEscrow(client, businessId, amountUSD, description, metadata = {}) {
  // Convert USD to cents
  const amountCents = Math.round(amountUSD * 100);

  return client.request('POST', '/api/stripe/payments/create', {
    businessId,
    amount: amountCents,
    currency: 'usd',
    description,
    metadata,
    escrowMode: true,
  });
}

/**
 * List card escrows
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {Object} [options={}] - Filtering options
 * @param {string} [options.businessId] - Filter by business ID
 * @param {string} [options.status] - Filter by status
 * @param {number} [options.limit] - Maximum number of results
 * @param {number} [options.offset] - Results offset
 * @returns {Promise<Object>} List of card escrows
 * 
 * @example
 * const escrows = await listCardEscrows(client, { 
 *   businessId: 'business-id', 
 *   status: 'pending' 
 * });
 */
export async function listCardEscrows(client, options = {}) {
  const queryParams = new URLSearchParams();
  if (options.businessId) queryParams.set('businessId', options.businessId);
  if (options.status) queryParams.set('status', options.status);
  if (options.limit) queryParams.set('limit', options.limit.toString());
  if (options.offset) queryParams.set('offset', options.offset.toString());

  const queryString = queryParams.toString();
  const url = `/api/stripe/escrows${queryString ? `?${queryString}` : ''}`;
  
  return client.request('GET', url);
}

/**
 * Release a card escrow
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} escrowId - Escrow ID to release
 * @returns {Promise<Object>} Release result
 * 
 * @example
 * const result = await releaseCardEscrow(client, 'escrow-123');
 */
export async function releaseCardEscrow(client, escrowId) {
  return client.request('POST', '/api/stripe/escrow/release', {
    escrowId,
  });
}

/**
 * Refund a card escrow
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} escrowId - Escrow ID to refund
 * @param {Object} [options={}] - Refund options
 * @param {number} [options.amount] - Partial refund amount in cents
 * @param {string} [options.reason] - Refund reason
 * @returns {Promise<Object>} Refund result
 * 
 * @example
 * // Full refund
 * const result = await refundCardEscrow(client, 'escrow-123');
 * 
 * // Partial refund
 * const result = await refundCardEscrow(client, 'escrow-123', { 
 *   amount: 2500,  // $25.00 in cents
 *   reason: 'partial_delivery' 
 * });
 */
export async function refundCardEscrow(client, escrowId, options = {}) {
  return client.request('POST', '/api/stripe/escrow/refund', {
    escrowId,
    ...options,
  });
}

/**
 * Get card escrow status and transaction details
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} escrowId - Escrow/transaction ID
 * @returns {Promise<Object>} Transaction details with escrow status
 * 
 * @example
 * const status = await getCardEscrowStatus(client, 'escrow-123');
 * console.log(status.escrow_status); // 'pending', 'released', 'refunded'
 */
export async function getCardEscrowStatus(client, escrowId) {
  return client.request('GET', `/api/stripe/transactions/${escrowId}`);
}

/**
 * Default export with all convenience functions
 */
export default {
  createQuickCardPayment,
  waitForStripeOnboarding,
  createCardPaymentWithOnboardingCheck,
  getPaymentMethodSupport,
  formatCardAmount,
  calculateCardPaymentFees,
  createCardEscrow,
  listCardEscrows,
  releaseCardEscrow,
  refundCardEscrow,
  getCardEscrowStatus,
};