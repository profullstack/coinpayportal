import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import Stripe from 'stripe';

let _stripe: Stripe;
function getStripe() {
  return (_stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover' as const,
  }));
}

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
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
      .from('subscriptions')
      .select('*, subscription_plans(name, amount, currency, interval)')
      .eq('merchant_id', merchantId)
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

    const stripe = getStripe();

    // Create checkout session for subscription
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com'}/subscriptions?success=true`,
      cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com'}/subscriptions?canceled=true`,
      metadata: { ...metadata, plan_id: plan.id, merchant_id: merchantId, business_id: plan.business_id },
      subscription_data: {
        metadata: { plan_id: plan.id, merchant_id: merchantId, business_id: plan.business_id },
        ...(plan.trial_days ? { trial_period_days: plan.trial_days } : {}),
      },
    };

    if (customerEmail) sessionParams.customer_email = customerEmail;
    if (customerId) sessionParams.customer = customerId;

    // Use application_fee_percent for platform fee on connected account
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
