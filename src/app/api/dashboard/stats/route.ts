import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { verifyToken } from '@/lib/auth/jwt';

const JWT_SECRET = process.env.JWT_SECRET!;

/**
 * GET /api/dashboard/stats
 * Fetch dashboard statistics for merchant
 * Query params:
 *   - business_id: Optional filter by specific business
 */
export async function GET(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Verify token
    let payload;
    try {
      payload = verifyToken(token, JWT_SECRET);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = payload.userId;

    // Get optional business_id filter from query params
    const { searchParams } = new URL(request.url);
    const filterBusinessId = searchParams.get('business_id');

    // Get merchant's businesses (with names for dropdown)
    const { data: businesses, error: businessError } = await supabaseAdmin
      .from('businesses')
      .select('id, name')
      .eq('merchant_id', merchantId)
      .order('name');

    if (businessError) {
      console.error('Business fetch error:', businessError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch businesses' },
        { status: 500 }
      );
    }

    const allBusinessIds = businesses?.map((b) => b.id) || [];

    // If no businesses, return empty stats
    if (allBusinessIds.length === 0) {
      return NextResponse.json({
        success: true,
        businesses: [],
        stats: {
          total_payments: 0,
          successful_payments: 0,
          pending_payments: 0,
          failed_payments: 0,
          total_volume: '0',
          total_volume_usd: '0',
          total_commission_usd: '0',
        },
        recent_payments: [],
      });
    }

    // Determine which business IDs to query
    // If filtering by specific business, verify it belongs to this merchant
    let queryBusinessIds: string[];
    if (filterBusinessId) {
      if (!allBusinessIds.includes(filterBusinessId)) {
        return NextResponse.json(
          { success: false, error: 'Business not found' },
          { status: 404 }
        );
      }
      queryBusinessIds = [filterBusinessId];
    } else {
      queryBusinessIds = allBusinessIds;
    }

    // Fetch payment statistics
    const { data: payments, error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .in('business_id', queryBusinessIds)
      .order('created_at', { ascending: false })
      .limit(100);

    if (paymentsError) {
      console.error('Payments fetch error:', paymentsError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch payments' },
        { status: 500 }
      );
    }

    // Calculate statistics
    // Note: 'forwarded' means payment was successful and funds sent to merchant
    const total_payments = payments?.length || 0;
    const successful_payments =
      payments?.filter((p) =>
        p.status === 'completed' || p.status === 'forwarded' || p.status === 'forwarding'
      ).length || 0;
    const pending_payments =
      payments?.filter((p) => p.status === 'pending' || p.status === 'detected')
        .length || 0;
    const failed_payments =
      payments?.filter((p) => p.status === 'failed' || p.status === 'expired')
        .length || 0;

    // Calculate total volume (sum of successful payments - completed/forwarded)
    const successfulPayments = payments?.filter((p) =>
      p.status === 'completed' || p.status === 'forwarded' || p.status === 'forwarding'
    ) || [];
    const total_volume = successfulPayments.reduce(
      (sum, p) => sum + parseFloat(p.crypto_amount || '0'),
      0
    );
    const total_volume_usd = successfulPayments.reduce(
      (sum, p) => sum + parseFloat(p.amount || '0'),
      0
    );

    // Calculate total commission paid (from forwarded and completed payments)
    const total_commission_usd = successfulPayments.reduce(
      (sum, p) => sum + parseFloat(p.fee_amount || '0'),
      0
    );

    // Get recent payments (last 10)
    const recent_payments = payments?.slice(0, 10).map((p) => ({
      id: p.id,
      amount_crypto: p.crypto_amount,
      amount_usd: p.amount,
      currency: p.currency,
      status: p.status,
      created_at: p.created_at,
      payment_address: p.payment_address,
      merchant_wallet_address: p.merchant_wallet_address,
      merchant_amount: p.merchant_amount,
      fee_amount: p.fee_amount,
      forward_tx_hash: p.forward_tx_hash,
      forwarded_at: p.forwarded_at,
    })) || [];

    return NextResponse.json({
      success: true,
      businesses: businesses?.map((b) => ({ id: b.id, name: b.name })) || [],
      stats: {
        total_payments,
        successful_payments,
        pending_payments,
        failed_payments,
        total_volume: total_volume.toFixed(8),
        total_volume_usd: total_volume_usd.toFixed(2),
        total_commission_usd: total_commission_usd.toFixed(2),
      },
      recent_payments,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}