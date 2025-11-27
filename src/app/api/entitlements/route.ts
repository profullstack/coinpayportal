import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';
import { getEntitlements, checkTransactionLimit } from '@/lib/entitlements/service';

/**
 * GET /api/entitlements
 * Get current merchant's entitlements, features, and usage
 * 
 * Returns:
 * - Current subscription plan details
 * - Available features based on plan
 * - Current month's transaction usage and limits
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate request
    const authHeader = request.headers.get('authorization');
    const authResult = await authenticateRequest(supabase, authHeader);

    if (!authResult.success || !authResult.context) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      );
    }

    // Get merchant ID from auth context
    let merchantId: string;
    if (isMerchantAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
    } else if (isBusinessAuth(authResult.context)) {
      merchantId = authResult.context.merchantId;
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication context' },
        { status: 401 }
      );
    }

    // Get entitlements
    const entitlementsResult = await getEntitlements(supabase, merchantId);

    if (!entitlementsResult.success || !entitlementsResult.entitlements) {
      return NextResponse.json(
        { success: false, error: entitlementsResult.error || 'Failed to get entitlements' },
        { status: 400 }
      );
    }

    const { entitlements } = entitlementsResult;

    return NextResponse.json({
      success: true,
      entitlements: {
        plan: {
          id: entitlements.plan.id,
          name: entitlements.plan.name,
          description: entitlements.plan.description,
          price_monthly: entitlements.plan.price_monthly,
        },
        features: {
          all_chains_supported: entitlements.features.allChainsSupported,
          basic_api_access: entitlements.features.basicApiAccess,
          advanced_analytics: entitlements.features.advancedAnalytics,
          custom_webhooks: entitlements.features.customWebhooks,
          white_label: entitlements.features.whiteLabel,
          priority_support: entitlements.features.prioritySupport,
        },
        usage: {
          transactions_this_month: entitlements.usage.currentMonth,
          transaction_limit: entitlements.usage.limit,
          transactions_remaining: entitlements.usage.remaining,
          is_unlimited: entitlements.usage.limit === null,
        },
        status: entitlements.status,
      },
    });
  } catch (error) {
    console.error('Get entitlements error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}