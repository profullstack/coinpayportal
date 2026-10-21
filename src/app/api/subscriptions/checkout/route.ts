import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth, isBusinessAuth } from '@/lib/auth/middleware';
import { getSubscriptionPrice, type BillingPeriod } from '@/lib/subscriptions/service';
import { createSubscriptionCheckout, countOpenSubscriptionCheckouts } from '@/lib/subscriptions/checkout';
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
 * Start a plan upgrade as a hosted checkout session on CoinPay's own business:
 * the merchant picks any coin it can receive, or PayPal, on /checkout/cs_...
 *
 * Request body:
 * - plan_id: string (e.g., 'professional')
 * - billing_period: 'monthly' | 'yearly'
 * - blockchain: ignored (older clients send it; the buyer now picks on the page)
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
    const body = await request.json().catch(() => ({}));
    const { plan_id, billing_period } = body ?? {};

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
    // The route was authenticated but otherwise unbounded. Every call writes a
    // checkout session, and every coin picked on it derives an HD address, so
    // a retry loop in a client would accumulate rows without limit.
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

    const pendingCount = await countOpenSubscriptionCheckouts(supabase, merchantId);
    if (pendingCount !== null && pendingCount >= MAX_PENDING_SUBSCRIPTION_CHECKOUTS) {
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

    const result = await createSubscriptionCheckout(supabase, {
      merchantId,
      planId: plan_id,
      billingPeriod: billing_period as BillingPeriod,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, ...(result.code ? { code: result.code } : {}) },
        { status: result.status }
      );
    }

    const { session } = result;
    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        url: session.url,
        expires_at: session.expires_at,
        methods: session.methods,
      },
      // Same keys the pricing page (and older clients) already follow.
      payment: {
        id: session.id,
        checkout_path: session.path,
        checkout_url: session.url,
        amount: session.amount,
        currency: 'USD',
        expires_at: session.expires_at,
      },
      plan: {
        id: plan_id,
        name: 'Professional',
        billing_period,
        price,
      },
      instructions: `Open the checkout and pay $${price} with any listed coin or PayPal. Your plan activates as soon as the payment confirms.`,
    });
  } catch (error) {
    console.error('Subscription checkout error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
