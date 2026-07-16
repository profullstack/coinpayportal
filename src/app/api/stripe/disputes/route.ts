import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { listAccessibleOwnerMerchantIds } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { parsePaginationParam } from '@/lib/api/pagination';

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

    const ownerMerchantIds = await listAccessibleOwnerMerchantIds(supabase, merchantId);

    // Get query parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const businessId = searchParams.get('business_id');
    const limit = parsePaginationParam(searchParams.get('limit'), 50, { min: 1, max: 100 });
    const offset = parsePaginationParam(searchParams.get('offset'), 0);

    // Optional business filter. Disputes have no business_id column, so resolve
    // the charges belonging to that business and constrain by stripe_charge_id.
    let chargeIdFilter: string[] | null = null;
    if (businessId) {
      const { data: bizCharges } = await supabase
        .from('stripe_transactions')
        .select('stripe_charge_id')
        .eq('business_id', businessId)
        .in('merchant_id', ownerMerchantIds)
        .not('stripe_charge_id', 'is', null);
      chargeIdFilter = (bizCharges || [])
        .map((t) => t.stripe_charge_id as string)
        .filter(Boolean);
      // No charges for this business → no disputes.
      if (chargeIdFilter.length === 0) {
        return NextResponse.json(
          {
            success: true,
            disputes: [],
            pagination: { limit, offset, total: 0, has_more: false },
          },
          { status: 200 }
        );
      }
    }

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
      .in('merchant_id', ownerMerchantIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (chargeIdFilter) {
      query = query.in('stripe_charge_id', chargeIdFilter);
    }

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

    // Enrich with the business each disputed charge belongs to (disputes carry no
    // business_id; map via stripe_transactions.stripe_charge_id).
    const chargeIds = (disputes || [])
      .map((d) => d.stripe_charge_id as string)
      .filter(Boolean);
    const businessByCharge = new Map<string, { id: string | null; name: string }>();
    if (chargeIds.length > 0) {
      const { data: txns } = await supabase
        .from('stripe_transactions')
        .select('stripe_charge_id, business_id, businesses(name)')
        .in('stripe_charge_id', chargeIds)
        .in('merchant_id', ownerMerchantIds);
      for (const t of txns || []) {
        const biz = (t as { businesses?: unknown }).businesses;
        let name = 'Unknown';
        if (Array.isArray(biz)) name = biz[0]?.name || 'Unknown';
        else if (biz && typeof biz === 'object' && 'name' in biz) {
          name = (biz as { name?: string }).name || 'Unknown';
        }
        businessByCharge.set(t.stripe_charge_id as string, {
          id: (t.business_id as string) || null,
          name,
        });
      }
    }

    // Only these dispute states can still be accepted/contested.
    const ACTIONABLE = new Set([
      'warning_needs_response',
      'warning_under_review',
      'needs_response',
      'under_review',
    ]);

    // Transform disputes to match expected format
    const transformedDisputes = (disputes || []).map(dispute => {
      const biz = dispute.stripe_charge_id
        ? businessByCharge.get(dispute.stripe_charge_id)
        : undefined;
      return {
        id: dispute.id,
        stripe_dispute_id: dispute.stripe_dispute_id,
        stripe_charge_id: dispute.stripe_charge_id,
        business_id: biz?.id || null,
        business_name: biz?.name || null,
        amount_cents: dispute.amount || 0,
        amount_usd: ((dispute.amount || 0) / 100).toFixed(2), // Convert cents to dollars
        currency: dispute.currency || 'usd',
        status: dispute.status,
        reason: dispute.reason,
        evidence_due_by: dispute.evidence_due_by,
        actionable: ACTIONABLE.has(String(dispute.status)),
        created_at: dispute.created_at,
        updated_at: dispute.updated_at,
      };
    });

    // Get total count for pagination
    let countQuery = supabase
      .from('stripe_disputes')
      .select('*', { count: 'exact', head: true })
      .in('merchant_id', ownerMerchantIds);
    if (chargeIdFilter) {
      countQuery = countQuery.in('stripe_charge_id', chargeIdFilter);
    }
    if (status) {
      countQuery = countQuery.eq('status', status);
    }
    const { count: totalCount, error: countError } = await countQuery;

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
