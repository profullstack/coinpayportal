import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import Stripe from 'stripe';

/**
 * GET /api/stripe/payouts
 * List payouts for authenticated merchant
 * Query params:
 *   - status: Filter by payout status (pending, paid, failed, canceled)
 *   - date_from: Filter payouts from this date (ISO string)
 *   - date_to: Filter payouts to this date (ISO string)
 *   - limit: Number of results to return (default 50, max 100)
 *   - offset: Pagination offset (default 0)
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

    // Get query parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query
    let query = supabase
      .from('stripe_payouts')
      .select(`
        id,
        stripe_payout_id,
        amount,
        currency,
        status,
        arrival_date,
        created_at,
        updated_at
      `)
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (dateFrom) {
      query = query.gte('created_at', new Date(dateFrom).toISOString());
    }

    if (dateTo) {
      // Add one day to include the entire end date
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      query = query.lt('created_at', endDate.toISOString());
    }

    const { data: payouts, error } = await query;

    if (error) {
      console.error('Error fetching payouts:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch payouts' },
        { status: 500 }
      );
    }

    // Transform payouts to match expected format
    const transformedPayouts = (payouts || []).map(payout => ({
      id: payout.id,
      stripe_payout_id: payout.stripe_payout_id,
      amount_cents: payout.amount || 0,
      amount_usd: ((payout.amount || 0) / 100).toFixed(2), // Convert cents to dollars
      currency: payout.currency || 'usd',
      status: payout.status,
      arrival_date: payout.arrival_date,
      created_at: payout.created_at,
      updated_at: payout.updated_at,
    }));

    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('stripe_payouts')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantId);

    if (countError) {
      console.error('Error getting payouts count:', countError);
    }

    return NextResponse.json(
      { 
        success: true, 
        payouts: transformedPayouts,
        pagination: {
          limit,
          offset,
          total: totalCount || 0,
          has_more: (offset + limit) < (totalCount || 0)
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('List payouts error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stripe/payouts
 * Create a payout to the merchant's connected Stripe account
 * Body: { amount, currency?, description?, metadata? }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
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
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = decoded.userId;
    const body = await request.json();
    const { amount, currency = 'usd', description, metadata } = body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount is required and must be a positive integer (in cents)' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey || !stripeSecretKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const stripe = new Stripe(stripeSecretKey);

    // Look up merchant's connected Stripe account
    const { data: merchant, error: merchantError } = await supabase
      .from('businesses')
      .select('stripe_account_id')
      .eq('user_id', merchantId)
      .not('stripe_account_id', 'is', null)
      .limit(1)
      .single();

    if (merchantError || !merchant?.stripe_account_id) {
      return NextResponse.json(
        { success: false, error: 'No connected Stripe account found. Complete Stripe onboarding first.' },
        { status: 400 }
      );
    }

    // Create the payout via Stripe API on the connected account
    const payout = await stripe.payouts.create(
      {
        amount,
        currency,
        description: description || 'CoinPay payout',
        metadata: metadata || {},
      },
      {
        stripeAccount: merchant.stripe_account_id,
      }
    );

    // Record in our database
    const { data: record, error: insertError } = await supabase
      .from('stripe_payouts')
      .insert({
        merchant_id: merchantId,
        stripe_payout_id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        arrival_date: payout.arrival_date
          ? new Date(payout.arrival_date * 1000).toISOString()
          : null,
        description: payout.description,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error recording payout:', insertError);
    }

    return NextResponse.json(
      {
        success: true,
        payout: {
          id: record?.id || payout.id,
          stripe_payout_id: payout.id,
          amount_cents: payout.amount,
          amount_usd: (payout.amount / 100).toFixed(2),
          currency: payout.currency,
          status: payout.status,
          arrival_date: payout.arrival_date
            ? new Date(payout.arrival_date * 1000).toISOString()
            : null,
          description: payout.description,
          created_at: record?.created_at || new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Create payout error:', error);

    // Handle Stripe-specific errors
    if (error?.type?.startsWith('Stripe')) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}