import { NextRequest, NextResponse } from 'next/server';
import { sanitizeStripeMetadata } from '@/lib/stripe/metadata';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { listAccessibleOwnerMerchantIds } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { getStripe } from '@/lib/server/optional-deps';
import { parsePaginationParam } from '@/lib/api/pagination';
import { getFeePercentage } from '@/lib/payments/fees';
import { isBusinessPaidTier } from '@/lib/entitlements/service';

/**
 * GET /api/stripe/subscriptions
 * List subscriptions for authenticated merchant
 * Query params: businessId, customerId, status, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    let decoded;
    try { decoded = verifyToken(authHeader.substring(7), jwtSecret); }
    catch { return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 }); }

    const merchantId = decoded.userId;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('businessId');
    const customerId = searchParams.get('customerId');
    const status = searchParams.get('status');
    const limit = parsePaginationParam(searchParams.get('limit'), 20, { min: 1, max: 100 });
    const offset = parsePaginationParam(searchParams.get('offset'), 0);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Team-aware: subscriptions of every business the caller can access.
    const ownerMerchantIds = await listAccessibleOwnerMerchantIds(supabase, merchantId);

    let query = supabase
      .from('subscriptions')
      .select('*, subscription_plans(name, amount, currency, interval)')
      .in('merchant_id', ownerMerchantIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (businessId) query = query.eq('business_id', businessId);
    if (customerId) query = query.eq('stripe_customer_id', customerId);
    if (status) query = query.eq('status', status);

    const { data: subscriptions, error } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, subscriptions: subscriptions || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/stripe/subscriptions
 * Create a subscription (or checkout session for new customers)
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    let decoded;
    try { decoded = verifyToken(authHeader.substring(7), jwtSecret); }
    catch { return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 }); }

    const merchantId = decoded.userId;
    const { planId, customerEmail, customerId, paymentMethodId, successUrl, cancelUrl, metadata = {} } = await request.json();

    if (!planId || (!customerEmail && !customerId)) {
      return NextResponse.json({ success: false, error: 'planId and either customerEmail or customerId required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up plan
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('stripe_price_id', planId)
      .eq('merchant_id', merchantId)
      .single();

    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    const stripe = await getStripe();

    // Actually charge the platform fee.
    //
    // This block previously carried a comment saying the fee was applied via
    // `application_fee_percent` — and never set the field. Every recurring card
    // subscription, on the only recurring card rail the product has, paid the
    // merchant 100% and the platform nothing. The comment is why it went
    // unnoticed: reading the code, the control appears to be there.
    //
    // Subscriptions take a percentage rather than a fixed amount, because the
    // charge recurs and its amount can change (proration, quantity, price
    // updates); a fixed `application_fee_amount` computed once at checkout
    // would be wrong on every later invoice.
    const isPaidTier = await isBusinessPaidTier(supabase, plan.business_id);
    const applicationFeePercent = Number((getFeePercentage(isPaidTier) * 100).toFixed(4));

    // Create checkout session for subscription
    const sessionParams: any = {
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com'}/subscriptions?success=true`,
      cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com'}/subscriptions?canceled=true`,
      // Caller metadata is spread FIRST so the platform's own keys always win.
      // A caller that sends `merchant_id` or `platform_fee_percent` cannot
      // overwrite what the webhook reads back.
      metadata: {
        ...sanitizeStripeMetadata(metadata, 'stripe/subscriptions'),
        plan_id: plan.id,
        merchant_id: merchantId,
        business_id: plan.business_id,
        platform_fee_percent: applicationFeePercent.toString(),
      },
      subscription_data: {
        application_fee_percent: applicationFeePercent,
        metadata: {
          plan_id: plan.id,
          merchant_id: merchantId,
          business_id: plan.business_id,
          platform_fee_percent: applicationFeePercent.toString(),
        },
        ...(plan.trial_days ? { trial_period_days: plan.trial_days } : {}),
      },
    };

    if (customerEmail) sessionParams.customer_email = customerEmail;
    if (customerId) sessionParams.customer = customerId;

    const session = await stripe.checkout.sessions.create(sessionParams, {
      stripeAccount: plan.stripe_account_id,
    });

    // Store pending subscription record
    const { data: subscription, error: insertError } = await supabase
      .from('subscriptions')
      .insert({
        merchant_id: merchantId,
        business_id: plan.business_id,
        plan_id: plan.id,
        stripe_checkout_session_id: session.id,
        stripe_account_id: plan.stripe_account_id,
        customer_email: customerEmail || null,
        stripe_customer_id: customerId || null,
        status: 'incomplete',
        metadata,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      subscription,
      checkout_url: session.url,
      session_id: session.id,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
