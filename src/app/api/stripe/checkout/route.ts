import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { createGatewayCharge, createEscrowCharge, type MerchantTier } from '@/lib/stripe/payments';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/stripe/checkout — Create a card payment (gateway or escrow mode)
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));

  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const merchantId = auth.context.merchantId;

  try {
    const body = await request.json();
    const { amount, currency = 'usd', mode = 'gateway', description, release_after_days } = body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Get merchant tier
    const { data: merchant } = await supabase
      .from('merchants')
      .select('tier, did')
      .eq('id', merchantId)
      .single();

    const tier: MerchantTier = merchant?.tier === 'pro' ? 'pro' : 'free';

    if (mode === 'escrow') {
      const paymentIntent = await createEscrowCharge({
        amount,
        currency,
        merchantId,
        merchantTier: tier,
        releaseAfterDays: release_after_days ?? 7,
        description,
      });

      return NextResponse.json({
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        mode: 'escrow',
      });
    }

    // Gateway mode — need Stripe connected account
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled')
      .eq('merchant_id', merchantId)
      .single();

    if (!stripeAccount?.charges_enabled) {
      return NextResponse.json(
        { error: 'Stripe account not ready for charges' },
        { status: 400 }
      );
    }

    const paymentIntent = await createGatewayCharge({
      amount,
      currency,
      stripeAccountId: stripeAccount.stripe_account_id,
      merchantTier: tier,
      description,
      metadata: { coinpay_merchant_id: merchantId },
    });

    return NextResponse.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      mode: 'gateway',
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Payment creation failed' },
      { status: 500 }
    );
  }
}
