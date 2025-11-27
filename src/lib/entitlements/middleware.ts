import type { SupabaseClient } from '@supabase/supabase-js';
import { getMerchantSubscription, getCurrentMonthUsage } from './service';

/**
 * Error codes for entitlement errors
 */
export type EntitlementErrorCode =
  | 'TRANSACTION_LIMIT_EXCEEDED'
  | 'FEATURE_NOT_AVAILABLE'
  | 'SUBSCRIPTION_INACTIVE'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'UNKNOWN_ERROR';

/**
 * Custom error class for entitlement-related errors
 */
export class EntitlementError extends Error {
  code: EntitlementErrorCode;
  details?: Record<string, any>;

  constructor(code: EntitlementErrorCode, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'EntitlementError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Result type for transaction limit check
 */
export interface TransactionLimitCheckResult {
  allowed: boolean;
  currentUsage: number;
  limit: number | null;
  remaining: number | null;
  error?: EntitlementError;
}

/**
 * Result type for feature access check
 */
export interface FeatureAccessResult {
  allowed: boolean;
  feature: string;
  error?: EntitlementError;
}

/**
 * Valid subscription statuses that allow operations
 */
const ACTIVE_STATUSES = ['active', 'trialing'];

/**
 * Feature column mapping for database queries
 */
const FEATURE_COLUMNS: Record<string, string> = {
  advanced_analytics: 'advanced_analytics',
  custom_webhooks: 'custom_webhooks',
  white_label: 'white_label',
  priority_support: 'priority_support',
  basic_api_access: 'basic_api_access',
  all_chains_supported: 'all_chains_supported',
};

/**
 * Check if a merchant can create a transaction based on their plan limits
 * Returns detailed information about usage and limits
 */
export async function withTransactionLimit(
  supabase: SupabaseClient,
  merchantId: string
): Promise<TransactionLimitCheckResult> {
  try {
    // Get merchant subscription
    const subscriptionResult = await getMerchantSubscription(supabase, merchantId);
    
    if (!subscriptionResult.success || !subscriptionResult.subscription) {
      return {
        allowed: false,
        currentUsage: 0,
        limit: null,
        remaining: null,
        error: new EntitlementError(
          'SUBSCRIPTION_NOT_FOUND',
          subscriptionResult.error || 'Subscription not found'
        ),
      };
    }

    const { subscription } = subscriptionResult;

    // Check subscription status
    if (!ACTIVE_STATUSES.includes(subscription.status)) {
      return {
        allowed: false,
        currentUsage: 0,
        limit: subscription.plan.monthly_transaction_limit,
        remaining: null,
        error: new EntitlementError(
          'SUBSCRIPTION_INACTIVE',
          `Subscription is ${subscription.status}. Please update your payment method or reactivate your subscription.`,
          { status: subscription.status }
        ),
      };
    }

    // Get current usage
    const usageResult = await getCurrentMonthUsage(supabase, merchantId);
    const currentUsage = usageResult.success ? (usageResult.count ?? 0) : 0;
    const limit = subscription.plan.monthly_transaction_limit;

    // Calculate remaining (null if unlimited)
    const remaining = limit === null ? null : Math.max(0, limit - currentUsage);
    const allowed = limit === null || currentUsage < limit;

    if (!allowed) {
      return {
        allowed: false,
        currentUsage,
        limit,
        remaining: 0,
        error: new EntitlementError(
          'TRANSACTION_LIMIT_EXCEEDED',
          `Monthly transaction limit reached (${currentUsage}/${limit}). Please upgrade to Professional for unlimited transactions.`,
          { currentUsage, limit }
        ),
      };
    }

    return {
      allowed: true,
      currentUsage,
      limit,
      remaining,
    };
  } catch (error) {
    return {
      allowed: false,
      currentUsage: 0,
      limit: null,
      remaining: null,
      error: new EntitlementError(
        'UNKNOWN_ERROR',
        error instanceof Error ? error.message : 'Unknown error checking transaction limit'
      ),
    };
  }
}

/**
 * Check if a merchant has access to a specific feature
 */
export async function withFeatureAccess(
  supabase: SupabaseClient,
  merchantId: string,
  feature: string
): Promise<FeatureAccessResult> {
  try {
    // Validate feature name
    if (!FEATURE_COLUMNS[feature]) {
      return {
        allowed: false,
        feature,
        error: new EntitlementError(
          'UNKNOWN_ERROR',
          `Unknown feature: ${feature}`
        ),
      };
    }

    // Get merchant subscription
    const subscriptionResult = await getMerchantSubscription(supabase, merchantId);
    
    if (!subscriptionResult.success || !subscriptionResult.subscription) {
      return {
        allowed: false,
        feature,
        error: new EntitlementError(
          'SUBSCRIPTION_NOT_FOUND',
          subscriptionResult.error || 'Subscription not found'
        ),
      };
    }

    const { subscription } = subscriptionResult;

    // Check subscription status
    if (!ACTIVE_STATUSES.includes(subscription.status)) {
      return {
        allowed: false,
        feature,
        error: new EntitlementError(
          'SUBSCRIPTION_INACTIVE',
          `Subscription is ${subscription.status}. Please update your payment method or reactivate your subscription.`,
          { status: subscription.status }
        ),
      };
    }

    // Check feature access from plan
    const plan = subscription.plan as any;
    const hasFeature = plan[feature] === true;

    if (!hasFeature) {
      const featureDisplayName = feature.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return {
        allowed: false,
        feature,
        error: new EntitlementError(
          'FEATURE_NOT_AVAILABLE',
          `${featureDisplayName} is not available on your current plan. Please upgrade to Professional to access this feature.`,
          { feature, currentPlan: subscription.planId }
        ),
      };
    }

    return {
      allowed: true,
      feature,
    };
  } catch (error) {
    return {
      allowed: false,
      feature,
      error: new EntitlementError(
        'UNKNOWN_ERROR',
        error instanceof Error ? error.message : 'Unknown error checking feature access'
      ),
    };
  }
}

/**
 * Middleware helper to enforce transaction limits in API routes
 * Throws EntitlementError if limit exceeded
 */
export async function enforceTransactionLimit(
  supabase: SupabaseClient,
  merchantId: string
): Promise<void> {
  const result = await withTransactionLimit(supabase, merchantId);
  
  if (!result.allowed && result.error) {
    throw result.error;
  }
}

/**
 * Middleware helper to enforce feature access in API routes
 * Throws EntitlementError if feature not available
 */
export async function enforceFeatureAccess(
  supabase: SupabaseClient,
  merchantId: string,
  feature: string
): Promise<void> {
  const result = await withFeatureAccess(supabase, merchantId, feature);
  
  if (!result.allowed && result.error) {
    throw result.error;
  }
}

/**
 * Create a JSON response for entitlement errors
 */
export function createEntitlementErrorResponse(error: EntitlementError): Response {
  const statusCode = getStatusCodeForError(error.code);
  
  return new Response(
    JSON.stringify({
      error: error.message,
      code: error.code,
      details: error.details,
    }),
    {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Get HTTP status code for entitlement error
 */
function getStatusCodeForError(code: EntitlementErrorCode): number {
  switch (code) {
    case 'TRANSACTION_LIMIT_EXCEEDED':
      return 429; // Too Many Requests
    case 'FEATURE_NOT_AVAILABLE':
      return 403; // Forbidden
    case 'SUBSCRIPTION_INACTIVE':
      return 402; // Payment Required
    case 'SUBSCRIPTION_NOT_FOUND':
      return 404; // Not Found
    default:
      return 500; // Internal Server Error
  }
}