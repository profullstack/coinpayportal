import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';
import {
  createSubscriptionPayment,
  getSubscriptionPrice,
  SUPPORTED_BLOCKCHAINS,
  type BillingPeriod,
  type SupportedBlockchain,
} from '@/lib/subscriptions/service';

/**
 * POST /api/subscriptions/checkout
 * Create a crypto payment for subscription upgrade
 * 
 * Request body:
 * - plan_id: string (e.g., 'professional')
 * - billing_period: 'monthly' | 'yearly'
 * - blockchain: 'BTC' | 'BCH' | 'ETH' | 'MATIC' | 'SOL'
 */
export async function POST(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const { plan_id, billing_period, blockchain } = body;

    // Validate plan_id
    if (!plan_id || plan_id !== 'professional') {
      return NextResponse.json(
        { success: false, error: 'Invalid plan. Only "professional" plan is available for upgrade.' },
        { status: 400 }
      );
    }

    // Validate billing_period
    if (!billing_period || !['monthly', 'yearly'].includes(billing_period)) {
      return NextResponse.json(
        { success: false, error: 'Invalid billing period. Must be "monthly" or "yearly".' },
        { status: 400 }
      );
    }

    // Validate blockchain
    if (!blockchain || !SUPPORTED_BLOCKCHAINS.includes(blockchain)) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Invalid blockchain. Supported: ${SUPPORTED_BLOCKCHAINS.join(', ')}` 
        },
        { status: 400 }
      );
    }

    // Get price for display
    const price = getSubscriptionPrice(plan_id, billing_period as BillingPeriod);
    if (price === null) {
      return NextResponse.json(
        { success: false, error: 'Unable to determine price for selected plan' },
        { status: 400 }
      );
    }

    // Create subscription payment
    const result = await createSubscriptionPayment(supabase, {
      merchantId,
      planId: plan_id,
      billingPeriod: billing_period as BillingPeriod,
      blockchain: blockchain as SupportedBlockchain,
    });

    if (!result.success || !result.payment) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to create subscription payment' },
        { status: 400 }
      );
    }

    // Return payment details for the user to complete
    return NextResponse.json({
      success: true,
      payment: {
        id: result.payment.id,
        payment_address: result.payment.paymentAddress,
        amount: result.payment.amount,
        currency: result.payment.currency,
        blockchain: result.payment.blockchain,
        expires_at: result.payment.expiresAt,
      },
      plan: {
        id: plan_id,
        name: 'Professional',
        billing_period,
        price,
      },
      instructions: `Send exactly $${price} worth of ${blockchain} to the payment address. Your subscription will be activated once the payment is confirmed on the blockchain.`,
    });
  } catch (error) {
    console.error('Subscription checkout error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}