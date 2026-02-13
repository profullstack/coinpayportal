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
 * GET /api/stripe/subscriptions/plans
 * List subscription plans for a business
 * Query params: businessId (required), limit, active
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    let decoded;
    try {
      decoded = verifyToken(authHeader.substring(7), jwtSecret);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
    }

    const merchantId = decoded.userId;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('businessId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const activeFilter = searchParams.get('active');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
      .from('subscription_plans')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (businessId) query = query.eq('business_id', businessId);
    if (activeFilter !== null && activeFilter !== undefined) {
      query = query.eq('active', activeFilter === 'true');
    }

    const { data: plans, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, plans: plans || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/stripe/subscriptions/plans
 * Create a subscription plan (Stripe Product + Price)
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    let decoded;
    try {
      decoded = verifyToken(authHeader.substring(7), jwtSecret);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
    }

    const merchantId = decoded.userId;
    const { businessId, name, description, amount, currency = 'usd', interval = 'month', intervalCount = 1, trialDays, metadata = {} } = await request.json();

    if (!businessId || !name || !amount) {
      return NextResponse.json({ success: false, error: 'businessId, name, and amount are required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify business belongs to merchant
    const { data: business } = await supabase
      .from('businesses')
      .select('id, merchant_id')
      .eq('id', businessId)
      .eq('merchant_id', merchantId)
      .single();

    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    // Get Stripe connected account
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('merchant_id', merchantId)
      .single();

    if (!stripeAccount?.stripe_account_id) {
      return NextResponse.json({ success: false, error: 'Stripe account not connected' }, { status: 400 });
    }

    const stripe = getStripe();

    // Create Stripe Product
    const product = await stripe.products.create(
      {
        name,
        description: description || undefined,
        metadata: { ...metadata, business_id: businessId, merchant_id: merchantId },
      },
      { stripeAccount: stripeAccount.stripe_account_id }
    );

    // Create Stripe Price
    const priceParams: Stripe.PriceCreateParams = {
      product: product.id,
      unit_amount: amount,
      currency,
      recurring: {
        interval: interval as Stripe.PriceCreateParams.Recurring.Interval,
        interval_count: intervalCount,
      },
      metadata: { business_id: businessId },
    };

    if (trialDays) {
      // Trial is set on the subscription, not the price, but we store it
    }

    const price = await stripe.prices.create(priceParams, {
      stripeAccount: stripeAccount.stripe_account_id,
    });

    // Store in database
    const { data: plan, error: insertError } = await supabase
      .from('subscription_plans')
      .insert({
        merchant_id: merchantId,
        business_id: businessId,
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        stripe_account_id: stripeAccount.stripe_account_id,
        name,
        description,
        amount,
        currency,
        interval,
        interval_count: intervalCount,
        trial_days: trialDays || null,
        metadata,
        active: true,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, plan }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
