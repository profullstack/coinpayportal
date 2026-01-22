import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Plan feature definitions - static reference for plan capabilities
 */
export const PLAN_FEATURES = {
  starter: {
    monthlyTransactionLimit: 100,
    allChainsSupported: true,
    basicApiAccess: true,
    advancedAnalytics: false,
    customWebhooks: false,
    whiteLabel: false,
    prioritySupport: false,
  },
  professional: {
    monthlyTransactionLimit: null, // unlimited
    allChainsSupported: true,
    basicApiAccess: true,
    advancedAnalytics: true,
    customWebhooks: true,
    whiteLabel: true,
    prioritySupport: true,
  },
} as const;

/**
 * Types
 */
export interface SubscriptionPlan {
  id: string;
  name: string;
  description?: string;
  price_monthly: number;
  price_yearly?: number;
  monthly_transaction_limit: number | null;
  all_chains_supported: boolean;
  basic_api_access: boolean;
  advanced_analytics: boolean;
  custom_webhooks: boolean;
  white_label: boolean;
  priority_support: boolean;
  is_active: boolean;
}

export interface MerchantSubscription {
  merchantId: string;
  planId: string;
  status: 'active' | 'cancelled' | 'past_due' | 'trialing';
  startedAt: string;
  endsAt?: string;
  plan: SubscriptionPlan;
}

export interface Entitlements {
  plan: SubscriptionPlan;
  features: {
    allChainsSupported: boolean;
    basicApiAccess: boolean;
    advancedAnalytics: boolean;
    customWebhooks: boolean;
    whiteLabel: boolean;
    prioritySupport: boolean;
  };
  usage: {
    currentMonth: number;
    limit: number | null;
    remaining: number | null;
  };
  status: 'active' | 'cancelled' | 'past_due' | 'trialing';
}

export interface PlanResult {
  success: boolean;
  plan?: SubscriptionPlan;
  error?: string;
}

export interface SubscriptionResult {
  success: boolean;
  subscription?: MerchantSubscription;
  error?: string;
}

export interface UsageResult {
  success: boolean;
  count?: number;
  error?: string;
}

export interface TransactionCheckResult {
  success: boolean;
  allowed?: boolean;
  error?: string;
}

export interface IncrementResult {
  success: boolean;
  newCount?: number;
  error?: string;
}

export interface FeatureResult {
  success: boolean;
  hasFeature?: boolean;
  error?: string;
}

export interface TransactionLimitResult {
  success: boolean;
  allowed?: boolean;
  currentUsage?: number;
  limit?: number | null;
  remaining?: number | null;
  error?: string;
}

export interface EntitlementsResult {
  success: boolean;
  entitlements?: Entitlements;
  error?: string;
}

/**
 * Get subscription plan details by ID
 */
export async function getSubscriptionPlan(
  supabase: SupabaseClient,
  planId: string
): Promise<PlanResult> {
  try {
    const { data: plan, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (error || !plan) {
      return {
        success: false,
        error: error?.message || 'Plan not found',
      };
    }

    return {
      success: true,
      plan: plan as SubscriptionPlan,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get subscription plan',
    };
  }
}

/**
 * Get merchant's current subscription details
 */
export async function getMerchantSubscription(
  supabase: SupabaseClient,
  merchantId: string
): Promise<SubscriptionResult> {
  try {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select(`
        id,
        subscription_plan_id,
        subscription_status,
        subscription_started_at,
        subscription_ends_at,
        subscription_plans (
          id,
          name,
          description,
          price_monthly,
          price_yearly,
          monthly_transaction_limit,
          all_chains_supported,
          basic_api_access,
          advanced_analytics,
          custom_webhooks,
          white_label,
          priority_support,
          is_active
        )
      `)
      .eq('id', merchantId)
      .single();

    if (error || !merchant) {
      return {
        success: false,
        error: error?.message || 'Merchant not found',
      };
    }

    const plan = merchant.subscription_plans as unknown as SubscriptionPlan;

    return {
      success: true,
      subscription: {
        merchantId: merchant.id,
        planId: merchant.subscription_plan_id,
        status: merchant.subscription_status as MerchantSubscription['status'],
        startedAt: merchant.subscription_started_at,
        endsAt: merchant.subscription_ends_at,
        plan,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get merchant subscription',
    };
  }
}

/**
 * Get current month's transaction usage for a merchant
 */
export async function getCurrentMonthUsage(
  supabase: SupabaseClient,
  merchantId: string
): Promise<UsageResult> {
  try {
    const { data, error } = await supabase.rpc('get_current_month_usage', {
      p_merchant_id: merchantId,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      count: data ?? 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get current month usage',
    };
  }
}

/**
 * Check if merchant can create a new transaction (based on plan limits)
 */
export async function canCreateTransaction(
  supabase: SupabaseClient,
  merchantId: string
): Promise<TransactionCheckResult> {
  try {
    const { data, error } = await supabase.rpc('can_create_transaction', {
      p_merchant_id: merchantId,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      allowed: data ?? false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check transaction permission',
    };
  }
}

/**
 * Increment transaction count for current month
 */
export async function incrementTransactionCount(
  supabase: SupabaseClient,
  merchantId: string
): Promise<IncrementResult> {
  try {
    const { data, error } = await supabase.rpc('increment_transaction_count', {
      p_merchant_id: merchantId,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      newCount: data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to increment transaction count',
    };
  }
}

/**
 * Check if merchant has a specific feature enabled
 */
export async function hasFeature(
  supabase: SupabaseClient,
  merchantId: string,
  feature: string
): Promise<FeatureResult> {
  try {
    const { data, error } = await supabase.rpc('has_feature', {
      p_merchant_id: merchantId,
      p_feature: feature,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      hasFeature: data ?? false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check feature access',
    };
  }
}

/**
 * Check transaction limit with detailed information
 * Returns current usage, limit, and remaining transactions
 */
export async function checkTransactionLimit(
  supabase: SupabaseClient,
  merchantId: string
): Promise<TransactionLimitResult> {
  try {
    // Get merchant subscription
    const subscriptionResult = await getMerchantSubscription(supabase, merchantId);
    if (!subscriptionResult.success || !subscriptionResult.subscription) {
      return {
        success: false,
        error: subscriptionResult.error || 'Failed to get subscription',
      };
    }

    const { subscription } = subscriptionResult;
    const limit = subscription.plan.monthly_transaction_limit;

    // Get current usage
    const usageResult = await getCurrentMonthUsage(supabase, merchantId);
    if (!usageResult.success) {
      return {
        success: false,
        error: usageResult.error || 'Failed to get usage',
      };
    }

    const currentUsage = usageResult.count ?? 0;

    // Calculate remaining (null if unlimited)
    const remaining = limit === null ? null : Math.max(0, limit - currentUsage);
    const allowed = limit === null || currentUsage < limit;

    return {
      success: true,
      allowed,
      currentUsage,
      limit,
      remaining,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check transaction limit',
    };
  }
}

/**
 * Get all entitlements for a merchant
 * Comprehensive view of plan, features, and usage
 */
export async function getEntitlements(
  supabase: SupabaseClient,
  merchantId: string
): Promise<EntitlementsResult> {
  try {
    // Get merchant subscription
    const subscriptionResult = await getMerchantSubscription(supabase, merchantId);
    if (!subscriptionResult.success || !subscriptionResult.subscription) {
      return {
        success: false,
        error: subscriptionResult.error || 'Failed to get subscription',
      };
    }

    const { subscription } = subscriptionResult;
    const { plan } = subscription;

    // Get current usage
    const usageResult = await getCurrentMonthUsage(supabase, merchantId);
    if (!usageResult.success) {
      return {
        success: false,
        error: usageResult.error || 'Failed to get usage',
      };
    }

    const currentUsage = usageResult.count ?? 0;
    const limit = plan.monthly_transaction_limit;
    const remaining = limit === null ? null : Math.max(0, limit - currentUsage);

    return {
      success: true,
      entitlements: {
        plan,
        features: {
          allChainsSupported: plan.all_chains_supported,
          basicApiAccess: plan.basic_api_access,
          advancedAnalytics: plan.advanced_analytics,
          customWebhooks: plan.custom_webhooks,
          whiteLabel: plan.white_label,
          prioritySupport: plan.priority_support,
        },
        usage: {
          currentMonth: currentUsage,
          limit,
          remaining,
        },
        status: subscription.status,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get entitlements',
    };
  }
}

/**
 * Validate that a merchant can perform an action based on their plan
 * Throws an error if not allowed
 */
export async function requireFeature(
  supabase: SupabaseClient,
  merchantId: string,
  feature: string,
  featureDisplayName: string
): Promise<void> {
  const result = await hasFeature(supabase, merchantId, feature);
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to check feature access');
  }
  
  if (!result.hasFeature) {
    throw new Error(
      `${featureDisplayName} is not available on your current plan. Please upgrade to Professional to access this feature.`
    );
  }
}

/**
 * Validate that a merchant can create a transaction
 * Throws an error if limit reached
 */
export async function requireTransactionCapacity(
  supabase: SupabaseClient,
  merchantId: string
): Promise<void> {
  const result = await checkTransactionLimit(supabase, merchantId);

  if (!result.success) {
    throw new Error(result.error || 'Failed to check transaction limit');
  }

  if (!result.allowed) {
    throw new Error(
      `Monthly transaction limit reached (${result.currentUsage}/${result.limit}). Please upgrade to Professional for unlimited transactions.`
    );
  }
}

/**
 * Check if a merchant has a paid subscription tier
 * Used for tiered commission rates: paid tier = 0.5%, free tier = 1%
 *
 * @param supabase - Supabase client
 * @param merchantId - Merchant ID
 * @returns true if merchant is on Professional plan, false for Starter/free plan
 */
export async function isPaidTier(
  supabase: SupabaseClient,
  merchantId: string
): Promise<boolean> {
  try {
    const subscriptionResult = await getMerchantSubscription(supabase, merchantId);

    if (!subscriptionResult.success || !subscriptionResult.subscription) {
      // Default to free tier if subscription lookup fails
      console.warn(`[Entitlements] Could not get subscription for merchant ${merchantId}, defaulting to free tier`);
      return false;
    }

    const { subscription } = subscriptionResult;

    // Professional plan = paid tier, anything else = free tier
    const isPaid = subscription.plan.name.toLowerCase() === 'professional' &&
                   subscription.status === 'active';

    return isPaid;
  } catch (error) {
    console.error(`[Entitlements] Error checking paid tier for merchant ${merchantId}:`, error);
    // Default to free tier on error
    return false;
  }
}

/**
 * Check if a business has a paid subscription tier
 * Wrapper that gets merchant_id from business_id
 *
 * @param supabase - Supabase client
 * @param businessId - Business ID
 * @returns true if merchant is on Professional plan, false for Starter/free plan
 */
export async function isBusinessPaidTier(
  supabase: SupabaseClient,
  businessId: string
): Promise<boolean> {
  try {
    // Get merchant_id from business
    const { data: business, error } = await supabase
      .from('businesses')
      .select('merchant_id')
      .eq('id', businessId)
      .single();

    if (error || !business?.merchant_id) {
      console.warn(`[Entitlements] Could not get merchant_id for business ${businessId}, defaulting to free tier`);
      return false;
    }

    return isPaidTier(supabase, business.merchant_id);
  } catch (error) {
    console.error(`[Entitlements] Error checking paid tier for business ${businessId}:`, error);
    return false;
  }
}