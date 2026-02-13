import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { createExpressAccount, generateOnboardingLink, getAccountStatus } from '@/lib/stripe/accounts';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/stripe/connect — Create Express account + return onboarding URL
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));

  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const merchantId = auth.context.merchantId;

  // Check if merchant already has a Stripe account
  const { data: existing } = await supabase
    .from('stripe_accounts')
    .select('*')
    .eq('merchant_id', merchantId)
    .single();

  if (existing) {
    return NextResponse.json({ error: 'Stripe account already exists' }, { status: 409 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8080';

    // Create Express account
    const account = await createExpressAccount({
      merchantId,
      email: auth.context.email,
      country: body.country,
    });

    // Store in DB
    await supabase.from('stripe_accounts').insert({
      merchant_id: merchantId,
      stripe_account_id: account.id,
      account_type: 'express',
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      country: account.country,
      email: account.email,
    });

    // Generate onboarding link
    const link = await generateOnboardingLink({
      stripeAccountId: account.id,
      refreshUrl: `${baseUrl}/dashboard/stripe/refresh`,
      returnUrl: `${baseUrl}/dashboard/stripe/complete`,
    });

    return NextResponse.json({
      stripe_account_id: account.id,
      onboarding_url: link.url,
    });
  } catch (error) {
    console.error('Stripe Connect error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create Stripe account' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/stripe/connect — Get account status
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));

  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data: account } = await supabase
    .from('stripe_accounts')
    .select('*')
    .eq('merchant_id', auth.context.merchantId)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'No Stripe account found' }, { status: 404 });
  }

  try {
    const stripeAccount = await getAccountStatus(account.stripe_account_id);
    return NextResponse.json({
      id: account.id,
      stripe_account_id: account.stripe_account_id,
      charges_enabled: stripeAccount.charges_enabled,
      payouts_enabled: stripeAccount.payouts_enabled,
      details_submitted: stripeAccount.details_submitted,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to retrieve account status' },
      { status: 500 }
    );
  }
}
