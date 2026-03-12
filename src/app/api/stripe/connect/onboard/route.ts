import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/server/optional-deps';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const businessId = body.businessId || body.business_id;
    const { email, country = 'US' } = body;

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    // Look up the merchant_id from the business
    const { data: business } = await supabase
      .from('businesses')
      .select('merchant_id')
      .eq('id', businessId)
      .single();

    if (!business?.merchant_id) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const merchantId = business.merchant_id;

    // Check if merchant already has a Stripe account
    const { data: existingAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('merchant_id', merchantId)
      .single();

    let stripeAccountId = existingAccount?.stripe_account_id;

    // Verify existing Stripe account still exists, clean up if stale
    if (stripeAccountId) {
      try {
        await (await getStripe()).accounts.retrieve(stripeAccountId);
      } catch (verifyError: any) {
        if (verifyError?.code === 'account_invalid' || verifyError?.message?.includes('No such account')) {
          console.warn(`Stale Stripe account ${stripeAccountId} for merchant ${merchantId}, removing`);
          await supabase.from('stripe_accounts').delete().eq('merchant_id', merchantId);
          stripeAccountId = undefined;
        } else {
          throw verifyError;
        }
      }
    }

    // Create new Stripe Express account if needed
    if (!stripeAccountId) {
      const account = await (await getStripe()).accounts.create({
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
      const { error: insertError } = await supabase
        .from('stripe_accounts')
        .insert({
          merchant_id: merchantId,
          stripe_account_id: stripeAccountId,
          account_type: 'express',
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
          country: account.country,
          email: account.email,
        });

      if (insertError) {
        console.error('Failed to save Stripe account to database:', insertError);
        return NextResponse.json(
          { error: 'Stripe account created but failed to save. Contact support.', stripe_account_id: stripeAccountId },
          { status: 500 }
        );
      }
    }

    // Create onboarding link
    const accountLink = await (await getStripe()).accountLinks.create({
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
