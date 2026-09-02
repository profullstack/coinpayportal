import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { parsePaginationParam } from '@/lib/api/pagination';
import { listAccessibleBusinessIds } from '@/lib/auth/authz';

/**
 * GET /api/paypal/transactions
 *
 * List PayPal transactions across every business the caller can reach — the
 * analogue of GET /api/stripe/transactions.
 *
 * MONEY UNITS: `amount` here is in MAJOR units (10.00 = ten dollars), unlike the
 * Stripe rail's `amount_cents`. `amount_cents` is also returned, derived, so a
 * client that already speaks cents does not have to guess which rail it is
 * reading. Both describe the same money.
 *
 * Query params: business_id, status, date_from, date_to, limit, offset.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let decoded;
    try {
      decoded = verifyToken(authHeader.substring(7), jwtSecret);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const limit = parsePaginationParam(searchParams.get('limit'), 50, { min: 1, max: 100 });
    const offset = parsePaginationParam(searchParams.get('offset'), 0);

    // Scope by business, not merchant: that is what lets an invited team member
    // see the client's transactions, and it matches the Stripe rail.
    const accessibleBusinessIds = await listAccessibleBusinessIds(supabase, decoded.userId);
    if (accessibleBusinessIds.length === 0) {
      return NextResponse.json({ success: true, transactions: [] }, { status: 200 });
    }

    if (businessId && !accessibleBusinessIds.includes(businessId)) {
      return NextResponse.json(
        { success: false, error: 'Business not found or access denied' },
        { status: 403 }
      );
    }

    const scopedIds = businessId ? [businessId] : accessibleBusinessIds;

    let query = supabase
      .from('paypal_transactions')
      .select(
        `
        id,
        business_id,
        invoice_id,
        connection_mode,
        paypal_order_id,
        paypal_capture_id,
        payer_email,
        amount,
        currency,
        platform_fee_amount,
        paypal_fee_amount,
        net_to_merchant,
        refunded_amount,
        status,
        invoice_number,
        description,
        customer_name,
        customer_email,
        failure_reason,
        captured_at,
        created_at,
        updated_at,
        businesses (
          name
        )
      `
      )
      .in('business_id', scopedIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (dateFrom) query = query.gte('created_at', new Date(dateFrom).toISOString());
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      query = query.lt('created_at', endDate.toISOString());
    }

    const { data: transactions, error } = await query;

    if (error) {
      console.error('[PayPal] Error fetching transactions:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transactions' },
        { status: 500 }
      );
    }

    const transformed = (transactions || []).map((t: any) => {
      const businesses = t.businesses;
      let businessName = 'Unknown';
      if (Array.isArray(businesses) && businesses.length > 0) {
        businessName = businesses[0]?.name || 'Unknown';
      } else if (businesses && typeof businesses === 'object' && 'name' in businesses) {
        businessName = businesses.name || 'Unknown';
      }

      const amount = Number(t.amount ?? 0);
      return {
        id: t.id,
        business_id: t.business_id,
        business_name: businessName,
        invoice_id: t.invoice_id,
        connection_mode: t.connection_mode || 'self_serve',
        paypal_order_id: t.paypal_order_id,
        paypal_capture_id: t.paypal_capture_id,
        payer_email: t.payer_email,
        amount,
        amount_cents: Math.round(amount * 100),
        currency: t.currency || 'USD',
        platform_fee_amount: Number(t.platform_fee_amount ?? 0),
        paypal_fee_amount: t.paypal_fee_amount === null ? null : Number(t.paypal_fee_amount),
        net_to_merchant: t.net_to_merchant === null ? null : Number(t.net_to_merchant),
        refunded_amount: Number(t.refunded_amount ?? 0),
        status: t.status,
        rail: 'paypal',
        invoice_number: t.invoice_number,
        description: t.description,
        customer_name: t.customer_name,
        customer_email: t.customer_email,
        failure_reason: t.failure_reason,
        captured_at: t.captured_at,
        created_at: t.created_at,
        updated_at: t.updated_at,
      };
    });

    let countQuery = supabase
      .from('paypal_transactions')
      .select('*', { count: 'exact', head: true })
      .in('business_id', scopedIds);
    if (status) countQuery = countQuery.eq('status', status);
    const { count: totalCount } = await countQuery;

    return NextResponse.json(
      {
        success: true,
        transactions: transformed,
        pagination: {
          limit,
          offset,
          total: totalCount || 0,
          has_more: offset + limit < (totalCount || 0),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('List PayPal transactions error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
