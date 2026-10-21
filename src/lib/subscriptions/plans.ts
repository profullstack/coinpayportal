/**
 * Plan prices and the business that sells them. No imports, so the checkout
 * settle path (lib/checkout/settle.ts -> ./activate.ts) can use it without
 * pulling in the payments stack.
 */

export type BillingPeriod = 'monthly' | 'yearly';

export const SUBSCRIPTION_PRICES = {
  professional: {
    monthly: 49,
    yearly: 490, // ~17% discount
  },
} as const;

/** Get subscription price for a plan and billing period */
export function getSubscriptionPrice(planId: string, billingPeriod: BillingPeriod): number | null {
  const planPrices = SUBSCRIPTION_PRICES[planId as keyof typeof SUBSCRIPTION_PRICES];
  if (!planPrices) return null;
  const price = planPrices[billingPeriod as keyof typeof planPrices];
  return typeof price === 'number' ? price : null;
}

/**
 * CoinPay's own business (coinpayportal.com), which sells the plans. Its
 * wallets and PayPal connection decide what an upgrading merchant can pay
 * with. Override with COINPAY_BILLING_BUSINESS_ID.
 */
export const DEFAULT_BILLING_BUSINESS_ID = '9d5011d1-eaea-4a07-907e-67fd14925854';
export const BILLING_PROPERTY = 'coinpayportal.com';

export function billingBusinessId(): string {
  const fromEnv = process.env.COINPAY_BILLING_BUSINESS_ID;
  return fromEnv && /^[0-9a-f-]{36}$/i.test(fromEnv.trim()) ? fromEnv.trim() : DEFAULT_BILLING_BUSINESS_ID;
}
