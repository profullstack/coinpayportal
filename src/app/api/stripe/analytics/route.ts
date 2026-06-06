import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { listBusinesses } from '@/lib/business/service';
import { getJwtSecret } from '@/lib/secrets';

const TREND_DAYS = 14;

type TrendSeries = {
  volume_usd: number[];
  transactions: number[];
  successful_transactions: number[];
  fees_usd: number[];
};

function emptyTrendSeries(): TrendSeries {
  return {
    volume_usd: Array(TREND_DAYS).fill(0),
    transactions: Array(TREND_DAYS).fill(0),
    successful_transactions: Array(TREND_DAYS).fill(0),
    fees_usd: Array(TREND_DAYS).fill(0),
  };
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSuccessfulCryptoStatus(status: unknown): boolean {
  return ['completed', 'forwarded', 'forwarding'].includes(String(status || '').toLowerCase());
}

function isSuccessfulCardStatus(status: unknown): boolean {
  return ['completed', 'succeeded'].includes(String(status || '').toLowerCase());
}

function getCryptoVolumeUsd(payment: any): number {
  return toNumber(payment.amount ?? payment.amount_usd);
}

function getCryptoFeeUsd(payment: any): number {
  const feeUsd = toNumber(payment.fee_usd);
  if (feeUsd > 0) return feeUsd;

  const feeAmount = toNumber(payment.fee_amount);
  const cryptoAmount = toNumber(payment.crypto_amount);
  const usdAmount = getCryptoVolumeUsd(payment);

  if (feeAmount > 0 && cryptoAmount > 0 && usdAmount > 0) {
    return (feeAmount / cryptoAmount) * usdAmount;
  }

  return 0;
}

function getCardVolumeUsd(transaction: any): number {
  const amountCents = toNumber(transaction.amount);
  if (amountCents > 0) return amountCents / 100;
  return toNumber(transaction.amount_usd);
}

function getCardFeeUsd(transaction: any): number {
  return (
    toNumber(transaction.stripe_fee_amount ?? transaction.stripe_fee) +
    toNumber(transaction.platform_fee_amount ?? transaction.platform_fee)
  ) / 100;
}

function buildTrendLabels() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (TREND_DAYS - 1));

  return Array.from({ length: TREND_DAYS }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

function addTrendPoint(
  series: TrendSeries,
  index: number,
  volumeUsd: number,
  feeUsd: number,
  successful: boolean
) {
  series.transactions[index] += 1;
  if (!successful) return;

  series.successful_transactions[index] += 1;
  series.volume_usd[index] += volumeUsd;
  series.fees_usd[index] += feeUsd;
}

function buildTrends(cryptoPayments: any[], cardTransactions: any[]) {
  const labels = buildTrendLabels();
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const crypto = emptyTrendSeries();
  const card = emptyTrendSeries();
  const all = emptyTrendSeries();

  for (const payment of cryptoPayments || []) {
    if (!payment.created_at) continue;
    const index = labelIndex.get(new Date(payment.created_at).toISOString().slice(0, 10));
    if (index === undefined) continue;

    const successful = isSuccessfulCryptoStatus(payment.status);
    const volumeUsd = getCryptoVolumeUsd(payment);
    const feeUsd = getCryptoFeeUsd(payment);
    addTrendPoint(crypto, index, volumeUsd, feeUsd, successful);
    addTrendPoint(all, index, volumeUsd, feeUsd, successful);
  }

  for (const transaction of cardTransactions || []) {
    if (!transaction.created_at) continue;
    const index = labelIndex.get(new Date(transaction.created_at).toISOString().slice(0, 10));
    if (index === undefined) continue;

    const successful = isSuccessfulCardStatus(transaction.status);
    const volumeUsd = getCardVolumeUsd(transaction);
    const feeUsd = getCardFeeUsd(transaction);
    addTrendPoint(card, index, volumeUsd, feeUsd, successful);
    addTrendPoint(all, index, volumeUsd, feeUsd, successful);
  }

  return { labels, all, crypto, card };
}

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
          },
          trends: buildTrends([], []),
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
    const successfulCryptoPayments = (cryptoPayments || []).filter(p => isSuccessfulCryptoStatus(p.status));
    
    const cryptoAnalytics = {
      total_volume_usd: successfulCryptoPayments.reduce(
        (sum, p) => sum + getCryptoVolumeUsd(p), 0
      ).toFixed(2),
      total_transactions: cryptoPayments?.length || 0,
      successful_transactions: successfulCryptoPayments.length,
      total_fees_usd: successfulCryptoPayments.reduce(
        (sum, p) => sum + getCryptoFeeUsd(p), 0
      ).toFixed(2),
    };

    // Calculate card analytics
    const successfulCardTransactions = (cardTransactions || []).filter(t => isSuccessfulCardStatus(t.status));
    
    const cardAnalytics = {
      total_volume_usd: successfulCardTransactions.reduce(
        (sum, t) => sum + getCardVolumeUsd(t), 0
      ).toFixed(2),
      total_transactions: cardTransactions?.length || 0,
      successful_transactions: successfulCardTransactions.length,
      total_fees_usd: successfulCardTransactions.reduce(
        (sum, t) => sum + getCardFeeUsd(t), 0
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
        trends: buildTrends(cryptoPayments || [], cardTransactions || []),
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
