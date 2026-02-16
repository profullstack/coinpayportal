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
 * GET /api/stripe/balance
 * Get Stripe balance summary for authenticated merchant
 */
export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    // Verify token
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let decoded;
    try {
      decoded = verifyToken(token, jwtSecret);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = decoded.userId;

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get merchant's Stripe account
    const { data: stripeAccount, error: accountError } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled, payouts_enabled')
      .eq('merchant_id', merchantId)
      .single();

    if (accountError || !stripeAccount) {
      return NextResponse.json(
        { success: false, error: 'Stripe account not found' },
        { status: 404 }
      );
    }

    if (!stripeAccount.stripe_account_id) {
      return NextResponse.json(
        { success: false, error: 'Stripe account not properly configured' },
        { status: 400 }
      );
    }

    let stripeBalance;
    try {
      // Get balance from Stripe for the connected account
      stripeBalance = await getStripe().balance.retrieve({
        stripeAccount: stripeAccount.stripe_account_id,
      });
    } catch (stripeError: any) {
      console.error('Error fetching Stripe balance:', stripeError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch Stripe balance' },
        { status: 500 }
      );
    }

    // Transform Stripe balance data
    const available = stripeBalance.available.map(balance => ({
      amount_cents: balance.amount,
      amount_usd: (balance.amount / 100).toFixed(2),
      currency: balance.currency,
    }));

    const pending = stripeBalance.pending.map(balance => ({
      amount_cents: balance.amount,
      amount_usd: (balance.amount / 100).toFixed(2),
      currency: balance.currency,
    }));

    // Calculate totals (assuming primary currency is USD)
    const totalAvailable = available.find(b => b.currency === 'usd')?.amount_cents || 0;
    const totalPending = pending.find(b => b.currency === 'usd')?.amount_cents || 0;

    const transformedBalance = {
      available: {
        total_usd: (totalAvailable / 100).toFixed(2),
        by_currency: available,
      },
      pending: {
        total_usd: (totalPending / 100).toFixed(2),
        by_currency: pending,
      },
      account_status: {
        charges_enabled: stripeAccount.charges_enabled,
        payouts_enabled: stripeAccount.payouts_enabled,
      },
    };

    return NextResponse.json(
      { success: true, balance: transformedBalance },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get Stripe balance error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}