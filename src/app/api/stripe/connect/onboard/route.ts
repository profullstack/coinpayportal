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
    const body = await request.json();
    const businessId = body.businessId || body.business_id;
    const { email, country = 'US' } = body;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    // Check if merchant already has a Stripe account
    const { data: existingAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('merchant_id', businessId)
      .single();

    let stripeAccountId = existingAccount?.stripe_account_id;

    // Create new Stripe Express account if needed
    if (!stripeAccountId) {
      const account = await getStripe().accounts.create({
        type: 'express',
        country,
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual', // Default to individual
      });

      stripeAccountId = account.id;

      // Store in database
      await supabase
        .from('stripe_accounts')
        .insert({
          merchant_id: businessId,
          stripe_account_id: stripeAccountId,
          account_type: 'express',
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
          country: account.country,
          email: account.email,
        });
    }

    // Create onboarding link
    const accountLink = await getStripe().accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/businesses/${businessId}`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/businesses/${businessId}?stripe_onboarding=complete`,
      type: 'account_onboarding',
    });

    return NextResponse.json({
      success: true,
      stripe_account_id: stripeAccountId,
      url: accountLink.url,
      onboarding_url: accountLink.url,
    });

  } catch (error: any) {
    console.error('Stripe Connect onboarding error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create onboarding link' },
      { status: 500 }
    );
  }
}