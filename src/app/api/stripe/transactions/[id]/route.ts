import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { listAccessibleBusinessIds } from '@/lib/auth/authz';

/**
 * GET /api/stripe/transactions/[id]
 * Get detailed information about a single card transaction
 */
export async function GET(request: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  try {
    const { id } = params;

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

    // Fetch transaction with business details
    const { data: transaction, error } = await supabase
      .from('stripe_transactions')
      .select(`
        id,
        business_id,
        amount,
        currency,
        platform_fee_amount,
        stripe_fee_amount,
        net_to_merchant,
        status,
        rail,
        stripe_payment_intent_id,
        stripe_charge_id,
        stripe_balance_txn_id,
        customer_name,
        customer_email,
        created_at,
        updated_at,
        businesses (
          id,
          name
        )
      `)
      .eq('id', id)
      .maybeSingle();

    // Team-aware access: the row is visible if the caller can access its
    // business (owner or team member), not just if they own it directly.
    const accessibleBusinessIds = await listAccessibleBusinessIds(supabase, merchantId);
    if (error || !transaction || !accessibleBusinessIds.includes(transaction.business_id)) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Handle businesses - can be object or array depending on Supabase response
    const businesses = transaction.businesses;
    let businessName = 'Unknown';
    let businessId = transaction.business_id;
    if (businesses) {
      if (Array.isArray(businesses) && businesses.length > 0) {
        businessName = businesses[0]?.name || 'Unknown';
        businessId = businesses[0]?.id || businessId;
      } else if (typeof businesses === 'object' && 'name' in businesses && 'id' in businesses) {
        const businessObj = businesses as { name: string; id: string };
        businessName = businessObj.name || 'Unknown';
        businessId = businessObj.id || businessId;
      }
    }

    const transformedTransaction = {
      id: transaction.id,
      business_id: businessId,
      business_name: businessName,
      amount_cents: transaction.amount || 0,
      amount_usd: ((transaction.amount || 0) / 100).toFixed(2), // Convert cents to dollars
      currency: transaction.currency || 'usd',
      platform_fee_amount: transaction.platform_fee_amount || 0,
      platform_fee_usd: ((transaction.platform_fee_amount || 0) / 100).toFixed(2),
      stripe_fee_amount: transaction.stripe_fee_amount || 0,
      stripe_fee_usd: ((transaction.stripe_fee_amount || 0) / 100).toFixed(2),
      net_to_merchant: transaction.net_to_merchant || 0,
      net_to_merchant_usd: ((transaction.net_to_merchant || 0) / 100).toFixed(2),
      status: transaction.status,
      rail: transaction.rail || 'card',
      stripe_payment_intent_id: transaction.stripe_payment_intent_id,
      stripe_charge_id: transaction.stripe_charge_id || null,
      stripe_balance_txn_id: transaction.stripe_balance_txn_id || null,
      customer_name: transaction.customer_name || null,
      customer_email: transaction.customer_email || null,
      created_at: transaction.created_at,
      updated_at: transaction.updated_at,
      // For UI compatibility, add card-specific fields
      last4: null, // Will be populated when we have actual card data
      brand: null, // Will be populated when we have actual card data
    };

    return NextResponse.json(
      { success: true, transaction: transformedTransaction },
      { status: 200 }
    );
  } catch (error) {
    console.error('Get card transaction error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}