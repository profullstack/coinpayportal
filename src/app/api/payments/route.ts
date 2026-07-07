import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { listAccessibleBusinessIds } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
// Re-export POST from create sub-route so POST /api/payments works
export { POST } from './create/route';

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
    // Optional pagination. When `limit` is supplied we page the results and
    // return a total; without it the endpoint keeps its old "return all" behavior.
    const limitParam = searchParams.get('limit');
    const paginate = limitParam !== null;
    const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // All businesses this user can access — owned plus those granted via org or
    // per-business team membership. Owner-only scoping here hid data from invited
    // team members (they saw only their own businesses).
    const userBusinessIds = await listAccessibleBusinessIds(supabase, decoded.userId);

    // If no businesses, return empty array
    if (userBusinessIds.length === 0) {
      return NextResponse.json(
        { success: true, payments: [] },
        { status: 200 }
      );
    }

    // Build query - include business name via join. count:'exact' returns the
    // total matching rows (ignoring the range) so we can paginate.
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
        merchant_wallet_address,
        tx_hash,
        forward_tx_hash,
        confirmations,
        created_at,
        expires_at,
        fee_amount,
        merchant_amount,
        detected_at,
        confirmed_at,
        forwarded_at,
        metadata,
        businesses (
          name
        )
      `, { count: 'exact' })
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

    if (paginate) {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: payments, error, count } = await query;

    // Status summary across ALL matching rows (so paginated UIs can show accurate
    // totals in their summary cards, not just the current page).
    let summary: { total: number; successful: number; pending: number; failed: number } | undefined;
    if (paginate && !error) {
      let statusQuery = supabase.from('payments').select('status').in('business_id', userBusinessIds);
      if (businessId && userBusinessIds.includes(businessId)) statusQuery = statusQuery.eq('business_id', businessId);
      const { data: statusRows } = await statusQuery;
      const successStatuses = new Set(['completed', 'confirmed', 'forwarded', 'forwarding']);
      const pendingStatuses = new Set(['pending', 'detected']);
      const failedStatuses = new Set(['failed', 'expired', 'forwarding_failed', 'settle_failed', 'settlement_failed']);
      summary = { total: count ?? (statusRows?.length ?? 0), successful: 0, pending: 0, failed: 0 };
      for (const r of statusRows || []) {
        const s = String(r.status || '').toLowerCase();
        if (successStatuses.has(s)) summary.successful++;
        else if (pendingStatuses.has(s)) summary.pending++;
        else if (failedStatuses.has(s)) summary.failed++;
      }
    }

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
        merchant_wallet: payment.merchant_wallet_address || '',
        tx_hash: payment.tx_hash || null,
        forward_tx_hash: payment.forward_tx_hash || null,
        confirmations: payment.confirmations || 0,
        created_at: payment.created_at,
        expires_at: payment.expires_at,
        detected_at: payment.detected_at || null,
        confirmed_at: payment.confirmed_at || null,
        forwarded_at: payment.forwarded_at || null,
        fee_amount: payment.fee_amount?.toString() || null,
        merchant_amount: payment.merchant_amount?.toString() || null,
        metadata: payment.metadata || {},
      };
    });

    return NextResponse.json(
      {
        success: true,
        payments: transformedPayments,
        ...(paginate
          ? {
              pagination: { limit, offset, total: count ?? 0, has_more: offset + limit < (count ?? 0) },
              summary,
            }
          : {}),
      },
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