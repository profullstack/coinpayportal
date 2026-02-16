import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

let _stripe: Stripe;
function getStripe() {
  return (_stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover' as const,
  }));
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { 
      businessId, 
      amount, 
      currency = 'usd', 
      description, 
      metadata = {},
      successUrl,
      cancelUrl,
    } = await request.json();

    if (!businessId || !amount || !currency) {
      return NextResponse.json(
        { error: 'businessId, amount, and currency are required' }, 
        { status: 400 }
      );
    }

    // Get business and its tier info
    const { data: business } = await supabase
      .from('businesses')
      .select('tier, merchant_id')
      .eq('id', businessId)
      .single();

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Get Stripe account
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled')
      .eq('merchant_id', business.merchant_id)
      .single();

    if (!stripeAccount?.stripe_account_id || !stripeAccount.charges_enabled) {
      return NextResponse.json(
        { error: 'Stripe account not found or not enabled for charges' }, 
        { status: 400 }
      );
    }

    // Calculate platform fee based on tier
    const platformFeeRate = business.tier === 'pro' ? 0.005 : 0.01;
    const platformFeeAmount = Math.round(amount * platformFeeRate);

    const sessionMetadata = {
      ...metadata,
      business_id: businessId,
      merchant_id: business.merchant_id,
      platform_fee_amount: platformFeeAmount.toString(),
    };

    // Gateway Mode: destination charge, funds go directly to merchant
    const session = await getStripe().checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency,
              product_data: { name: description || 'Payment' },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        payment_intent_data: {
          application_fee_amount: platformFeeAmount,
          transfer_data: {
            destination: stripeAccount.stripe_account_id,
          },
        },
        success_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL}/payment/cancel`,
        metadata: sessionMetadata,
      });

    // Create transaction record
    await supabase
      .from('stripe_transactions')
      .insert({
        merchant_id: business.merchant_id,
        amount,
        currency,
        platform_fee_amount: platformFeeAmount,
        status: 'pending',
        rail: 'card',
      });

    return NextResponse.json({
      checkout_url: session.url,
      checkout_session_id: session.id,
      amount,
      currency,
      platform_fee_amount: platformFeeAmount,
    });

  } catch (error: any) {
    console.error('Stripe payment creation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create payment' },
      { status: 500 }
    );
  }
}
