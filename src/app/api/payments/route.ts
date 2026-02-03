import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { listBusinesses } from '@/lib/business/service';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/payments
 * List all payments for authenticated merchant's businesses
 * Supports filtering by business_id, status, currency, date_from, date_to
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

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');
    const currency = searchParams.get('currency');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    // First, get all businesses for this user to ensure they can only see their own payments
    const businessResult = await listBusinesses(supabase, decoded.userId);
    if (!businessResult.success || !businessResult.businesses) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch businesses' },
        { status: 400 }
      );
    }

    const userBusinessIds = businessResult.businesses.map(b => b.id);

    // If no businesses, return empty array
    if (userBusinessIds.length === 0) {
      return NextResponse.json(
        { success: true, payments: [] },
        { status: 200 }
      );
    }

    // Build query - include business name via join
    let query = supabase
      .from('payments')
      .select(`
        id,
        business_id,
        amount,
        currency,
        blockchain,
        status,
        crypto_amount,
        crypto_currency,
        payment_address,
        tx_hash,
        confirmations,
        metadata,
        created_at,
        expires_at,
        fee_amount,
        merchant_amount,
        businesses (
          name
        )
      `)
      .in('business_id', userBusinessIds)
      .order('created_at', { ascending: false });

    // Apply filters
    if (businessId && userBusinessIds.includes(businessId)) {
      query = query.eq('business_id', businessId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (currency) {
      query = query.ilike('blockchain', `%${currency}%`);
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

    const { data: payments, error } = await query;

    if (error) {
      console.error('Error fetching payments:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch payments' },
        { status: 500 }
      );
    }

    // Transform payments to match expected format
    const transformedPayments = (payments || []).map(payment => {
      // Handle businesses - can be object or array depending on Supabase response
      const businesses = payment.businesses;
      let businessName = 'Unknown';
      if (businesses) {
        if (Array.isArray(businesses) && businesses.length > 0) {
          businessName = businesses[0]?.name || 'Unknown';
        } else if (typeof businesses === 'object' && 'name' in businesses) {
          businessName = (businesses as { name: string }).name || 'Unknown';
        }
      }

      return {
        id: payment.id,
        business_id: payment.business_id,
        business_name: businessName,
        amount_crypto: payment.crypto_amount?.toString() || '0',
        amount_usd: payment.amount?.toString() || '0',
        currency: payment.blockchain || payment.crypto_currency || 'unknown',
        status: payment.status,
        payment_address: payment.payment_address || '',
        tx_hash: payment.tx_hash,
        confirmations: payment.confirmations || 0,
        created_at: payment.created_at,
        expires_at: payment.expires_at,
        fee_amount: payment.fee_amount?.toString() || null,
        merchant_amount: payment.merchant_amount?.toString() || null,
      };
    });

    return NextResponse.json(
      { success: true, payments: transformedPayments },
      { status: 200 }
    );
  } catch (error) {
    console.error('List payments error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}