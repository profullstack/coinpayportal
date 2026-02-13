import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { listBusinesses } from '@/lib/business/service';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/stripe/analytics
 * Fetch combined analytics (card + crypto) for merchant
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
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let payload;
    try {
      payload = verifyToken(token, jwtSecret);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = payload.userId;

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

    // Get optional business_id filter from query params
    const { searchParams } = new URL(request.url);
    const filterBusinessId = searchParams.get('business_id');

    // First, get all businesses for this user to ensure they can only see their own data
    const businessResult = await listBusinesses(supabase, merchantId);
    if (!businessResult.success || !businessResult.businesses) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch businesses' },
        { status: 400 }
      );
    }

    const allBusinessIds = businessResult.businesses.map(b => b.id);

    // If no businesses, return empty stats
    if (allBusinessIds.length === 0) {
      return NextResponse.json({
        success: true,
        analytics: {
          crypto: {
            total_volume_usd: '0',
            total_transactions: 0,
            successful_transactions: 0,
            total_fees_usd: '0',
          },
          card: {
            total_volume_usd: '0',
            total_transactions: 0,
            successful_transactions: 0,
            total_fees_usd: '0',
          },
          combined: {
            total_volume_usd: '0',
            total_transactions: 0,
            successful_transactions: 0,
            total_fees_usd: '0',
          }
        }
      });
    }

    // Determine which business IDs to query
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

    // Fetch crypto payments statistics
    const { data: cryptoPayments, error: cryptoError } = await supabase
      .from('payments')
      .select('*')
      .in('business_id', queryBusinessIds);

    if (cryptoError) {
      console.error('Error fetching crypto payments:', cryptoError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch crypto analytics' },
        { status: 500 }
      );
    }

    // Fetch card transactions statistics
    const { data: cardTransactions, error: cardError } = await supabase
      .from('stripe_transactions')
      .select('*')
      .eq('merchant_id', merchantId)
      .in('business_id', queryBusinessIds);

    if (cardError) {
      console.error('Error fetching card transactions:', cardError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch card analytics' },
        { status: 500 }
      );
    }

    // Calculate crypto analytics
    const successfulCryptoPayments = (cryptoPayments || []).filter(p => 
      p.status === 'completed' || p.status === 'forwarded' || p.status === 'forwarding'
    );
    
    const cryptoAnalytics = {
      total_volume_usd: successfulCryptoPayments.reduce(
        (sum, p) => sum + parseFloat(p.amount || '0'), 0
      ).toFixed(2),
      total_transactions: cryptoPayments?.length || 0,
      successful_transactions: successfulCryptoPayments.length,
      total_fees_usd: successfulCryptoPayments.reduce(
        (sum, p) => {
          const feeAmount = parseFloat(p.fee_amount || '0');
          const cryptoAmount = parseFloat(p.crypto_amount || '0');
          const usdAmount = parseFloat(p.amount || '0');
          
          // Convert fee to USD proportionally
          if (feeAmount > 0 && cryptoAmount > 0 && usdAmount > 0) {
            return sum + (feeAmount / cryptoAmount) * usdAmount;
          }
          return sum;
        }, 0
      ).toFixed(2),
    };

    // Calculate card analytics
    const successfulCardTransactions = (cardTransactions || []).filter(t => 
      t.status === 'completed'
    );
    
    const cardAnalytics = {
      total_volume_usd: successfulCardTransactions.reduce(
        (sum, t) => sum + (t.amount || 0) / 100, 0 // Convert from cents to dollars
      ).toFixed(2),
      total_transactions: cardTransactions?.length || 0,
      successful_transactions: successfulCardTransactions.length,
      total_fees_usd: successfulCardTransactions.reduce(
        (sum, t) => sum + ((t.stripe_fee_amount || 0) + (t.platform_fee_amount || 0)) / 100, 0 // Convert from cents
      ).toFixed(2),
    };

    // Calculate combined analytics
    const combinedAnalytics = {
      total_volume_usd: (
        parseFloat(cryptoAnalytics.total_volume_usd) + 
        parseFloat(cardAnalytics.total_volume_usd)
      ).toFixed(2),
      total_transactions: cryptoAnalytics.total_transactions + cardAnalytics.total_transactions,
      successful_transactions: cryptoAnalytics.successful_transactions + cardAnalytics.successful_transactions,
      total_fees_usd: (
        parseFloat(cryptoAnalytics.total_fees_usd) + 
        parseFloat(cardAnalytics.total_fees_usd)
      ).toFixed(2),
    };

    return NextResponse.json({
      success: true,
      analytics: {
        crypto: cryptoAnalytics,
        card: cardAnalytics,
        combined: combinedAnalytics,
      }
    });

  } catch (error) {
    console.error('Stripe analytics error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}