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
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

/**
 * Unpaid subscription checkouts one merchant may hold at once.
 *
 * A merchant legitimately abandons a checkout and starts another — switching
 * chain, or changing their mind on billing period — so this is generous. It
 * exists to stop unbounded accumulation, not to police normal indecision.
 */
const MAX_PENDING_SUBSCRIPTION_CHECKOUTS = 10;

/**
 * POST /api/subscriptions/checkout
 * Create a crypto payment for subscription upgrade
 * 
 * Request body:
 * - plan_id: string (e.g., 'professional')
 * - billing_period: 'monthly' | 'yearly'
 * - blockchain: 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
 */
export async function POST(request: NextRequest) {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
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

    // SUB-02: bound how many of these one merchant can have open.
    //
    // The route was authenticated but otherwise unbounded, and every call
    // derives an HD address, encrypts its private key and writes a
    // `business_collection_payments` row. A merchant looping it accumulates
    // rows and encrypted key material without limit and burns derivation
    // indexes that are never reclaimed — none of which needs an attacker, just
    // a retry loop in a client.
    //
    // Two bounds, because they catch different things: the rate limit stops a
    // burst, and the pending cap stops a slow accumulation that would never
    // trip a rate limit at all.
    const rate = await checkRateLimitAsync(merchantId, 'subscription_checkout');
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many subscription checkouts. Please try again shortly.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.max(1, rate.resetAt - Math.floor(Date.now() / 1000))) },
        }
      );
    }

    const { count: pendingCount, error: pendingError } = await supabase
      .from('business_collection_payments')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', merchantId)
      .eq('status', 'pending');

    if (pendingError) {
      console.error('[Subscriptions] Could not count pending checkouts:', pendingError);
    } else if ((pendingCount ?? 0) >= MAX_PENDING_SUBSCRIPTION_CHECKOUTS) {
      return NextResponse.json(
        {
          success: false,
          error:
            `You already have ${pendingCount} unpaid subscription checkouts. ` +
            'Complete or let one expire before starting another.',
        },
        { status: 409 }
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
        checkout_path: `/pay/${result.payment.id}`,
        checkout_url: `${appUrl.replace(/\/$/, '')}/pay/${result.payment.id}`,
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
