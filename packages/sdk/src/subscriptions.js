/**
 * CoinPay Subscriptions - Stripe subscription billing integration
 * 
 * Provides functions for managing subscription plans and customer subscriptions
 * through Stripe's subscription billing system.
 */

/**
 * Subscription plan intervals
 */
export const PlanInterval = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  YEARLY: 'year',
};

/**
 * Subscription statuses
 */
export const SubscriptionStatus = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  TRIALING: 'trialing',
  UNPAID: 'unpaid',
  PAUSED: 'paused',
};

/**
 * Create a subscription plan (Stripe Price + Product)
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {Object} params - Plan parameters
 * @param {string} params.businessId - Business ID
 * @param {string} params.name - Plan name
 * @param {string} [params.description] - Plan description
 * @param {number} params.amount - Amount in cents
 * @param {string} [params.currency='usd'] - Currency code
 * @param {string} [params.interval='month'] - Billing interval (day, week, month, year)
 * @param {number} [params.intervalCount=1] - Number of intervals between billings
 * @param {number} [params.trialDays] - Trial period in days
 * @param {Object} [params.metadata] - Custom metadata
 * @returns {Promise<Object>} Created plan
 * 
 * @example
 * const plan = await createSubscriptionPlan(client, {
 *   businessId: 'biz-123',
 *   name: 'Pro Monthly',
 *   amount: 2999,
 *   interval: 'month',
 * });
 */
export async function createSubscriptionPlan(client, params) {
  const {
    businessId,
    name,
    description,
    amount,
    currency = 'usd',
    interval = 'month',
    intervalCount = 1,
    trialDays,
    metadata = {},
  } = params;

  if (!businessId || !name || !amount) {
    throw new Error('businessId, name, and amount are required');
  }

  return client.request('/stripe/subscriptions/plans', {
    method: 'POST',
    body: JSON.stringify({
      businessId,
      name,
      description,
      amount,
      currency,
      interval,
      intervalCount,
      trialDays,
      metadata,
    }),
  });
}

/**
 * List subscription plans for a business
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} businessId - Business ID
 * @param {Object} [options] - Query options
 * @param {number} [options.limit=20] - Max results
 * @param {boolean} [options.active] - Filter by active status
 * @returns {Promise<Object>} List of plans
 */
export async function listSubscriptionPlans(client, businessId, options = {}) {
  const params = new URLSearchParams({ businessId });
  if (options.limit) params.set('limit', String(options.limit));
  if (options.active !== undefined) params.set('active', String(options.active));

  return client.request(`/stripe/subscriptions/plans?${params}`);
}

/**
 * Subscribe a customer to a plan
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {Object} params - Subscription parameters
 * @param {string} params.planId - Plan/Price ID
 * @param {string} params.customerEmail - Customer email
 * @param {string} [params.customerId] - Existing Stripe customer ID
 * @param {string} [params.paymentMethodId] - Payment method ID
 * @param {string} [params.successUrl] - Success redirect URL
 * @param {string} [params.cancelUrl] - Cancel redirect URL
 * @param {Object} [params.metadata] - Custom metadata
 * @returns {Promise<Object>} Subscription or checkout session
 * 
 * @example
 * const sub = await subscribeCustomer(client, {
 *   planId: 'price_123',
 *   customerEmail: 'customer@example.com',
 *   successUrl: 'https://mysite.com/success',
 *   cancelUrl: 'https://mysite.com/cancel',
 * });
 * // Redirect to sub.checkout_url
 */
export async function subscribeCustomer(client, params) {
  const {
    planId,
    customerEmail,
    customerId,
    paymentMethodId,
    successUrl,
    cancelUrl,
    metadata = {},
  } = params;

  if (!planId || (!customerEmail && !customerId)) {
    throw new Error('planId and either customerEmail or customerId are required');
  }

  return client.request('/stripe/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      planId,
      customerEmail,
      customerId,
      paymentMethodId,
      successUrl,
      cancelUrl,
      metadata,
    }),
  });
}

/**
 * Cancel a subscription
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} subscriptionId - Subscription ID
 * @param {Object} [options] - Cancellation options
 * @param {boolean} [options.immediately=false] - Cancel immediately vs at period end
 * @returns {Promise<Object>} Cancelled subscription
 */
export async function cancelSubscription(client, subscriptionId, options = {}) {
  if (!subscriptionId) {
    throw new Error('subscriptionId is required');
  }

  return client.request(`/stripe/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      immediately: options.immediately || false,
    }),
  });
}

/**
 * List subscriptions
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {Object} [options] - Query options
 * @param {string} [options.businessId] - Filter by business
 * @param {string} [options.customerId] - Filter by customer
 * @param {string} [options.status] - Filter by status
 * @param {number} [options.limit=20] - Max results
 * @param {number} [options.offset=0] - Pagination offset
 * @returns {Promise<Object>} List of subscriptions
 */
export async function listSubscriptions(client, options = {}) {
  const params = new URLSearchParams();
  if (options.businessId) params.set('businessId', options.businessId);
  if (options.customerId) params.set('customerId', options.customerId);
  if (options.status) params.set('status', options.status);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));

  return client.request(`/stripe/subscriptions?${params}`);
}

/**
 * Get subscription status/details
 * 
 * @param {import('./client.js').CoinPayClient} client - CoinPay client instance
 * @param {string} subscriptionId - Subscription ID
 * @returns {Promise<Object>} Subscription details
 */
export async function getSubscription(client, subscriptionId) {
  if (!subscriptionId) {
    throw new Error('subscriptionId is required');
  }

  return client.request(`/stripe/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/**
 * Format subscription amount for display
 * 
 * @param {number} amount - Amount in cents
 * @param {string} [currency='usd'] - Currency code
 * @param {string} [interval='month'] - Billing interval
 * @returns {string} Formatted amount (e.g., "$29.99/month")
 */
export function formatSubscriptionAmount(amount, currency = 'usd', interval = 'month') {
  const dollars = (amount / 100).toFixed(2);
  const symbol = currency.toLowerCase() === 'usd' ? '$' : currency.toUpperCase() + ' ';
  return `${symbol}${dollars}/${interval}`;
}
