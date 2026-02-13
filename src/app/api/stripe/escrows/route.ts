import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/stripe/escrows
 * List card payment escrows for authenticated merchant
 * Query params:
 *   - status: Filter by escrow status (pending_payment, funded, released, refunded)
 *   - date_from: Filter escrows from this date (ISO string)
 *   - date_to: Filter escrows to this date (ISO string)
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
      .from('stripe_escrows')
      .select(`
        id,
        total_amount,
        platform_fee,
        stripe_fee,
        releasable_amount,
        status,
        release_after,
        released_at,
        refunded_at,
        stripe_payment_intent_id,
        stripe_charge_id,
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

    const { data: escrows, error } = await query;

    if (error) {
      console.error('Error fetching escrows:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch escrows' },
        { status: 500 }
      );
    }

    // Transform escrows to match expected format
    const transformedEscrows = (escrows || []).map(escrow => ({
      id: escrow.id,
      total_amount_cents: escrow.total_amount || 0,
      total_amount_usd: ((escrow.total_amount || 0) / 100).toFixed(2), // Convert cents to dollars
      platform_fee_cents: escrow.platform_fee || 0,
      platform_fee_usd: ((escrow.platform_fee || 0) / 100).toFixed(2),
      stripe_fee_cents: escrow.stripe_fee || 0,
      stripe_fee_usd: ((escrow.stripe_fee || 0) / 100).toFixed(2),
      releasable_amount_cents: escrow.releasable_amount || 0,
      releasable_amount_usd: ((escrow.releasable_amount || 0) / 100).toFixed(2),
      status: escrow.status,
      release_after: escrow.release_after,
      released_at: escrow.released_at,
      refunded_at: escrow.refunded_at,
      stripe_payment_intent_id: escrow.stripe_payment_intent_id,
      stripe_charge_id: escrow.stripe_charge_id,
      created_at: escrow.created_at,
      updated_at: escrow.updated_at,
    }));

    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('stripe_escrows')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantId);

    if (countError) {
      console.error('Error getting escrows count:', countError);
    }

    return NextResponse.json(
      { 
        success: true, 
        escrows: transformedEscrows,
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
    console.error('List escrows error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}