import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/stripe/transactions
 * List card transactions for authenticated merchant's businesses
 * Supports filtering by business_id, status, date_from, date_to
 * Query params:
 *   - business_id: Filter by specific business
 *   - status: Filter by transaction status (pending, completed, failed)
 *   - date_from: Filter transactions from this date (ISO string)
 *   - date_to: Filter transactions to this date (ISO string)
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
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query - include business name via join
    let query = supabase
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
        created_at,
        updated_at,
        businesses (
          name
        )
      `)
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (businessId) {
      // Verify the business belongs to this merchant
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .eq('merchant_id', merchantId)
        .single();

      if (businessError || !business) {
        return NextResponse.json(
          { success: false, error: 'Business not found or access denied' },
          { status: 403 }
        );
      }

      query = query.eq('business_id', businessId);
    }

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

    const { data: transactions, error } = await query;

    if (error) {
      console.error('Error fetching card transactions:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transactions' },
        { status: 500 }
      );
    }

    // Transform transactions to match expected format
    const transformedTransactions = (transactions || []).map(transaction => {
      // Handle businesses - can be object or array depending on Supabase response
      const businesses = transaction.businesses;
      let businessName = 'Unknown';
      if (businesses) {
        if (Array.isArray(businesses) && businesses.length > 0) {
          businessName = businesses[0]?.name || 'Unknown';
        } else if (typeof businesses === 'object' && 'name' in businesses) {
          businessName = (businesses as { name: string }).name || 'Unknown';
        }
      }

      return {
        id: transaction.id,
        business_id: transaction.business_id,
        business_name: businessName,
        amount_cents: transaction.amount || 0,
        amount_usd: ((transaction.amount || 0) / 100).toFixed(2), // Convert cents to dollars
        currency: transaction.currency || 'usd',
        platform_fee_amount: transaction.platform_fee_amount || 0,
        stripe_fee_amount: transaction.stripe_fee_amount || 0,
        net_to_merchant: transaction.net_to_merchant || 0,
        status: transaction.status,
        rail: transaction.rail || 'card',
        stripe_payment_intent_id: transaction.stripe_payment_intent_id,
        stripe_charge_id: transaction.stripe_charge_id || null,
        stripe_balance_txn_id: transaction.stripe_balance_txn_id || null,
        created_at: transaction.created_at,
        updated_at: transaction.updated_at,
        // For UI compatibility, add card-specific fields
        last4: null, // Will be populated when we have actual card data
        brand: null, // Will be populated when we have actual card data
      };
    });

    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('stripe_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantId);

    if (countError) {
      console.error('Error getting transaction count:', countError);
    }

    return NextResponse.json(
      { 
        success: true, 
        transactions: transformedTransactions,
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
    console.error('List card transactions error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}