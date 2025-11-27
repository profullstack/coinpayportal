import type { SupabaseClient } from '@supabase/supabase-js';
import { createBusinessCollectionPayment } from '../payments/business-collection';

/**
 * Subscription payment types
 */
export type BillingPeriod = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing' | 'pending_payment';

/**
 * Subscription payment configuration
 */
export const SUBSCRIPTION_PRICES = {
  professional: {
    monthly: 49,
    yearly: 490, // ~17% discount
  },
} as const;

/**
 * Supported blockchains for subscription payments
 * Must match the blockchains supported by business-collection
 */
export const SUPPORTED_BLOCKCHAINS = ['BTC', 'BCH', 'ETH', 'MATIC', 'SOL'] as const;
export type SupportedBlockchain = typeof SUPPORTED_BLOCKCHAINS[number];

/**
 * Subscription payment input
 */
export interface SubscriptionPaymentInput {
  merchantId: string;
  planId: string;
  billingPeriod: BillingPeriod;
  blockchain: SupportedBlockchain;
}

/**
 * Check if blockchain is supported for subscriptions
 */
export function isSupportedBlockchain(blockchain: string): blockchain is SupportedBlockchain {
  return SUPPORTED_BLOCKCHAINS.includes(blockchain as SupportedBlockchain);
}

/**
 * Subscription payment result
 */
export interface SubscriptionPaymentResult {
  success: boolean;
  payment?: {
    id: string;
    paymentAddress: string;
    amount: number;
    currency: string;
    blockchain: string;
    expiresAt: string;
  };
  error?: string;
}

/**
 * Get subscription price for a plan and billing period
 */
export function getSubscriptionPrice(planId: string, billingPeriod: BillingPeriod): number | null {
  const planPrices = SUBSCRIPTION_PRICES[planId as keyof typeof SUBSCRIPTION_PRICES];
  if (!planPrices) {
    return null;
  }
  return planPrices[billingPeriod];
}

/**
 * Create a subscription payment using the business collection system
 * This creates a crypto payment that, when confirmed, will upgrade the merchant's subscription
 */
export async function createSubscriptionPayment(
  supabase: SupabaseClient,
  input: SubscriptionPaymentInput
): Promise<SubscriptionPaymentResult> {
  try {
    const { merchantId, planId, billingPeriod, blockchain } = input;

    // Validate plan
    const price = getSubscriptionPrice(planId, billingPeriod);
    if (price === null) {
      return {
        success: false,
        error: 'Invalid plan or billing period',
      };
    }

    // Validate blockchain
    if (!isSupportedBlockchain(blockchain)) {
      return {
        success: false,
        error: `Unsupported blockchain for subscription payments. Supported: ${SUPPORTED_BLOCKCHAINS.join(', ')}`,
      };
    }

    // Get merchant's first business (or create a system business for subscription payments)
    const { data: businesses, error: bizError } = await supabase
      .from('businesses')
      .select('id')
      .eq('merchant_id', merchantId)
      .limit(1);

    if (bizError) {
      return {
        success: false,
        error: bizError.message,
      };
    }

    // Use the first business or a placeholder
    const businessId = businesses?.[0]?.id;
    if (!businessId) {
      return {
        success: false,
        error: 'No business found. Please create a business first.',
      };
    }

    // Create a business collection payment for the subscription
    // Cast blockchain to the expected type since we've validated it
    const paymentResult = await createBusinessCollectionPayment(supabase, {
      businessId,
      merchantId,
      amount: price,
      currency: 'USD',
      blockchain: blockchain as 'BTC' | 'BCH' | 'ETH' | 'MATIC' | 'SOL',
      description: `${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan - ${billingPeriod === 'yearly' ? 'Annual' : 'Monthly'} Subscription`,
      metadata: {
        type: 'subscription_payment',
        plan_id: planId,
        billing_period: billingPeriod,
        merchant_id: merchantId,
      },
    });

    if (!paymentResult.success || !paymentResult.payment) {
      return {
        success: false,
        error: paymentResult.error || 'Failed to create subscription payment',
      };
    }

    // Store pending subscription upgrade
    await supabase.from('subscription_history').insert({
      merchant_id: merchantId,
      previous_plan_id: 'starter',
      new_plan_id: planId,
      change_type: 'pending_payment',
      metadata: {
        payment_id: paymentResult.payment.id,
        billing_period: billingPeriod,
        amount: price,
        blockchain,
      },
    });

    return {
      success: true,
      payment: {
        id: paymentResult.payment.id,
        paymentAddress: paymentResult.payment.paymentAddress,
        amount: price,
        currency: 'USD',
        blockchain,
        expiresAt: paymentResult.payment.expiresAt,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create subscription payment',
    };
  }
}

/**
 * Handle confirmed subscription payment
 * Called when a business collection payment for subscription is confirmed
 */
export async function handleSubscriptionPaymentConfirmed(
  supabase: SupabaseClient,
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the payment details
    const { data: payment, error: paymentError } = await supabase
      .from('business_collection_payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return {
        success: false,
        error: paymentError?.message || 'Payment not found',
      };
    }

    // Check if this is a subscription payment
    const metadata = payment.metadata as any;
    if (metadata?.type !== 'subscription_payment') {
      return {
        success: false,
        error: 'Not a subscription payment',
      };
    }

    const merchantId = metadata.merchant_id;
    const planId = metadata.plan_id;
    const billingPeriod = metadata.billing_period as BillingPeriod;

    // Calculate subscription end date
    const now = new Date();
    const endDate = new Date(now);
    if (billingPeriod === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    // Update merchant subscription
    const { error: updateError } = await supabase
      .from('merchants')
      .update({
        subscription_plan_id: planId,
        subscription_status: 'active',
        subscription_started_at: now.toISOString(),
        subscription_ends_at: endDate.toISOString(),
      })
      .eq('id', merchantId);

    if (updateError) {
      return {
        success: false,
        error: updateError.message,
      };
    }

    // Update subscription history
    await supabase
      .from('subscription_history')
      .update({
        change_type: 'upgrade',
        metadata: {
          ...metadata,
          confirmed_at: now.toISOString(),
          subscription_ends_at: endDate.toISOString(),
        },
      })
      .eq('merchant_id', merchantId)
      .eq('change_type', 'pending_payment')
      .contains('metadata', { payment_id: paymentId });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process subscription payment',
    };
  }
}

/**
 * Get merchant's subscription status
 */
export async function getSubscriptionStatus(
  supabase: SupabaseClient,
  merchantId: string
): Promise<{
  success: boolean;
  subscription?: {
    planId: string;
    status: SubscriptionStatus;
    startedAt: string | null;
    endsAt: string | null;
    isActive: boolean;
    daysRemaining: number | null;
  };
  error?: string;
}> {
  try {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('subscription_plan_id, subscription_status, subscription_started_at, subscription_ends_at')
      .eq('id', merchantId)
      .single();

    if (error || !merchant) {
      return {
        success: false,
        error: error?.message || 'Merchant not found',
      };
    }

    const now = new Date();
    const endsAt = merchant.subscription_ends_at ? new Date(merchant.subscription_ends_at) : null;
    const isActive = merchant.subscription_status === 'active' && (!endsAt || endsAt > now);
    
    let daysRemaining: number | null = null;
    if (endsAt && isActive) {
      daysRemaining = Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      success: true,
      subscription: {
        planId: merchant.subscription_plan_id || 'starter',
        status: merchant.subscription_status as SubscriptionStatus || 'active',
        startedAt: merchant.subscription_started_at,
        endsAt: merchant.subscription_ends_at,
        isActive,
        daysRemaining,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get subscription status',
    };
  }
}

/**
 * Cancel subscription (downgrade to starter at end of billing period)
 */
export async function cancelSubscription(
  supabase: SupabaseClient,
  merchantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current subscription
    const { data: merchant, error: fetchError } = await supabase
      .from('merchants')
      .select('subscription_plan_id, subscription_ends_at')
      .eq('id', merchantId)
      .single();

    if (fetchError || !merchant) {
      return {
        success: false,
        error: fetchError?.message || 'Merchant not found',
      };
    }

    if (merchant.subscription_plan_id === 'starter') {
      return {
        success: false,
        error: 'Already on Starter plan',
      };
    }

    // Mark subscription as cancelled (will downgrade at end of period)
    const { error: updateError } = await supabase
      .from('merchants')
      .update({
        subscription_status: 'cancelled',
      })
      .eq('id', merchantId);

    if (updateError) {
      return {
        success: false,
        error: updateError.message,
      };
    }

    // Log cancellation
    await supabase.from('subscription_history').insert({
      merchant_id: merchantId,
      previous_plan_id: merchant.subscription_plan_id,
      new_plan_id: 'starter',
      change_type: 'cancellation',
      metadata: {
        cancelled_at: new Date().toISOString(),
        effective_at: merchant.subscription_ends_at,
      },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel subscription',
    };
  }
}

/**
 * Check and expire subscriptions that have ended
 * This should be run periodically (e.g., daily cron job)
 */
export async function expireEndedSubscriptions(
  supabase: SupabaseClient
): Promise<{ success: boolean; expiredCount: number; error?: string }> {
  try {
    const now = new Date().toISOString();

    // Find and update expired subscriptions
    const { data: expired, error } = await supabase
      .from('merchants')
      .update({
        subscription_plan_id: 'starter',
        subscription_status: 'active',
      })
      .lt('subscription_ends_at', now)
      .neq('subscription_plan_id', 'starter')
      .select('id');

    if (error) {
      return {
        success: false,
        expiredCount: 0,
        error: error.message,
      };
    }

    // Log expirations
    if (expired && expired.length > 0) {
      const historyEntries = expired.map((m) => ({
        merchant_id: m.id,
        previous_plan_id: 'professional',
        new_plan_id: 'starter',
        change_type: 'downgrade',
        metadata: {
          reason: 'subscription_expired',
          expired_at: now,
        },
      }));

      await supabase.from('subscription_history').insert(historyEntries);
    }

    return {
      success: true,
      expiredCount: expired?.length || 0,
    };
  } catch (error) {
    return {
      success: false,
      expiredCount: 0,
      error: error instanceof Error ? error.message : 'Failed to expire subscriptions',
    };
  }
}