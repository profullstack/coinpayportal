import type { SupabaseClient } from '@supabase/supabase-js';
import { eligibleMethods, generateSessionId } from '@/lib/checkout/sessions';
import { isValidEmail } from '@/lib/checkout/customer';
import { BILLING_PROPERTY, billingBusinessId, getSubscriptionPrice, type BillingPeriod } from './plans';

export { BILLING_PROPERTY, billingBusinessId };

/**
 * CoinPay's own plan checkout, as a hosted checkout session.
 *
 * The session belongs to CoinPay's own business, so the merchant upgrading is
 * the BUYER: they pick any coin that business can receive, or PayPal when it
 * is connected, on /checkout/cs_... like any other buyer. When the session is
 * paid, lib/subscriptions/activate.ts grants the plan (see
 * lib/checkout/settle.ts, which calls it).
 *
 * This replaced a business_collection_payments flow that offered five coins
 * and sent the buyer to /pay/<collection id>, a page that only reads the
 * payments table, so every Upgrade click landed on "Payment not found".
 */

export const SUBSCRIPTION_SESSION_MINUTES = 60;

export interface SubscriptionCheckoutInput {
  merchantId: string;
  planId: string;
  billingPeriod: BillingPeriod;
}

export type SubscriptionCheckoutResult =
  | {
      success: true;
      session: { id: string; url: string; path: string; amount: number; expires_at: string; methods: string[] };
    }
  | { success: false; status: number; error: string; code?: string };

function planLabel(planId: string, billingPeriod: BillingPeriod): string {
  const name = planId.charAt(0).toUpperCase() + planId.slice(1);
  return `${name} Plan - ${billingPeriod === 'yearly' ? 'Annual' : 'Monthly'} Subscription`;
}

export async function createSubscriptionCheckout(
  supabase: SupabaseClient,
  input: SubscriptionCheckoutInput
): Promise<SubscriptionCheckoutResult> {
  const { merchantId, planId, billingPeriod } = input;
  const price = getSubscriptionPrice(planId, billingPeriod);
  if (price === null) return { success: false, status: 400, error: 'Invalid plan or billing period' };

  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email')
    .eq('id', merchantId)
    .maybeSingle();
  if (!merchant) return { success: false, status: 404, error: 'Merchant not found' };
  const email = typeof merchant.email === 'string' ? merchant.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) {
    return { success: false, status: 400, error: 'Your account needs a valid email address before you can upgrade', code: 'MISSING_CUSTOMER_EMAIL' };
  }

  const businessId = billingBusinessId();
  const { data: business } = await supabase
    .from('businesses')
    .select('id, merchant_id')
    .eq('id', businessId)
    .maybeSingle();
  if (!business?.merchant_id) {
    console.error('[Subscriptions] billing business not found:', businessId);
    return { success: false, status: 500, error: 'Plan checkout is not configured' };
  }

  const methods = await eligibleMethods(supabase, {
    business_id: business.id,
    merchant_id: business.merchant_id,
    allowed_methods: null,
  });
  if (methods.length === 0) {
    console.error('[Subscriptions] billing business has no payment methods:', businessId);
    return { success: false, status: 500, error: 'Plan checkout is not configured' };
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, '');
  const id = generateSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SUBSCRIPTION_SESSION_MINUTES * 60_000);
  const { error } = await supabase.from('checkout_sessions').insert({
    id,
    business_id: business.id,
    merchant_id: business.merchant_id,
    amount: price,
    currency: 'USD',
    description: planLabel(planId, billingPeriod),
    customer_email: email,
    account_id: merchantId,
    property: BILLING_PROPERTY,
    metadata: {
      type: 'subscription_payment',
      plan_id: planId,
      billing_period: billingPeriod,
      merchant_id: merchantId,
    },
    success_url: `${appUrl}/pricing?upgraded=1&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/pricing`,
    allowed_methods: null,
    expires_in_minutes: SUBSCRIPTION_SESSION_MINUTES,
    status: 'open',
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  if (error) {
    console.error('[Subscriptions] checkout session insert failed:', error);
    return { success: false, status: 500, error: 'Failed to start checkout' };
  }

  return {
    success: true,
    session: {
      id,
      path: `/checkout/${id}`,
      url: `${appUrl}/checkout/${id}`,
      amount: price,
      expires_at: expiresAt.toISOString(),
      methods: methods.map((m) => m.code),
    },
  };
}

/** Open plan checkouts this merchant holds right now (for the pending cap). */
export async function countOpenSubscriptionCheckouts(
  supabase: SupabaseClient,
  merchantId: string
): Promise<number | null> {
  const { count, error } = await supabase
    .from('checkout_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', billingBusinessId())
    .eq('account_id', merchantId)
    .eq('status', 'open')
    .gt('expires_at', new Date().toISOString());
  if (error) {
    console.error('[Subscriptions] Could not count open checkouts:', error);
    return null;
  }
  return count ?? 0;
}
