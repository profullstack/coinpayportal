import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const { accountId } = params;

    // Get Stripe account from database
    const { data: accountRecord } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('merchant_id', accountId)
      .single();

    if (!accountRecord?.stripe_account_id) {
      return NextResponse.json({ error: 'Stripe account not found' }, { status: 404 });
    }

    // Get account details from Stripe
    const account = await stripe.accounts.retrieve(accountRecord.stripe_account_id);

    // Update local database with latest info
    await supabase
      .from('stripe_accounts')
      .update({
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_account_id', accountRecord.stripe_account_id);

    // Check requirements
    const hasRequiredInfo = account.requirements?.currently_due?.length === 0;
    const hasDisabledReason = account.requirements?.disabled_reason;

    return NextResponse.json({
      stripe_account_id: account.id,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements_due: account.requirements?.currently_due || [],
      disabled_reason: hasDisabledReason,
      onboarding_complete: hasRequiredInfo && account.details_submitted && account.charges_enabled,
      country: account.country,
      email: account.email,
    });

  } catch (error: any) {
    console.error('Stripe account status error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get account status' },
      { status: 500 }
    );
  }
}