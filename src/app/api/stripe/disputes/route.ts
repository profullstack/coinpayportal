import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/stripe/disputes
 * List card payment disputes for authenticated merchant
 * Query params:
 *   - status: Filter by dispute status (warning_needs_response, warning_under_review, etc.)
 *   - date_from: Filter disputes from this date (ISO string)
 *   - date_to: Filter disputes to this date (ISO string)
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
      .from('stripe_disputes')
      .select(`
        id,
        stripe_dispute_id,
        stripe_charge_id,
        amount,
        currency,
        status,
        reason,
        evidence_due_by,
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

    const { data: disputes, error } = await query;

    if (error) {
      console.error('Error fetching disputes:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch disputes' },
        { status: 500 }
      );
    }

    // Transform disputes to match expected format
    const transformedDisputes = (disputes || []).map(dispute => ({
      id: dispute.id,
      stripe_dispute_id: dispute.stripe_dispute_id,
      stripe_charge_id: dispute.stripe_charge_id,
      amount_cents: dispute.amount || 0,
      amount_usd: ((dispute.amount || 0) / 100).toFixed(2), // Convert cents to dollars
      currency: dispute.currency || 'usd',
      status: dispute.status,
      reason: dispute.reason,
      evidence_due_by: dispute.evidence_due_by,
      created_at: dispute.created_at,
      updated_at: dispute.updated_at,
    }));

    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('stripe_disputes')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantId);

    if (countError) {
      console.error('Error getting disputes count:', countError);
    }

    return NextResponse.json(
      { 
        success: true, 
        disputes: transformedDisputes,
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
    console.error('List disputes error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}