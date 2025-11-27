import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/subscription-plans
 * List all available subscription plans
 * 
 * This endpoint is public and does not require authentication.
 * Returns all active subscription plans with their features and pricing.
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

    // Get all active subscription plans
    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching subscription plans:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch subscription plans' },
        { status: 500 }
      );
    }

    // Format plans for response
    const formattedPlans = plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      pricing: {
        monthly: plan.price_monthly,
        yearly: plan.price_yearly,
      },
      limits: {
        monthly_transactions: plan.monthly_transaction_limit,
        is_unlimited: plan.monthly_transaction_limit === null,
      },
      features: {
        all_chains_supported: plan.all_chains_supported,
        basic_api_access: plan.basic_api_access,
        advanced_analytics: plan.advanced_analytics,
        custom_webhooks: plan.custom_webhooks,
        white_label: plan.white_label,
        priority_support: plan.priority_support,
      },
    }));

    return NextResponse.json({
      success: true,
      plans: formattedPlans,
    });
  } catch (error) {
    console.error('Get subscription plans error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}