import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/server/optional-deps';

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

    // Get business info
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('merchant_id')
      .eq('id', businessId)
      .single();

    if (bizError || !business) {
      console.error('Business lookup failed:', bizError);
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Get Stripe account for this business
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled')
      .eq('business_id', businessId)
      .single();

    if (!stripeAccount?.stripe_account_id || !stripeAccount.charges_enabled) {
      return NextResponse.json(
        { error: 'Stripe account not found or not enabled for charges' }, 
        { status: 400 }
      );
    }

    // Calculate platform fee (0.5% default)
    const platformFeeRate = 0.005;
    const platformFeeAmount = Math.round(amount * platformFeeRate);

    const sessionMetadata = {
      ...metadata,
      business_id: businessId,
      merchant_id: business.merchant_id,
      platform_fee_amount: platformFeeAmount.toString(),
    };

    // Gateway Mode: destination charge, funds go directly to merchant
    const session = await (await getStripe()).checkout.sessions.create({
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
