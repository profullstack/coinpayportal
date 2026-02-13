import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { getCardReputationSummary } from '@/lib/stripe/reputation';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/stripe/dashboard — Merchant dashboard data
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));

  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const merchantId = auth.context.merchantId;

  try {
    // Fetch transactions
    const { data: transactions } = await supabase
      .from('stripe_transactions')
      .select('amount, platform_fee_amount, stripe_fee_amount, net_to_merchant, status')
      .eq('merchant_id', merchantId)
      .eq('status', 'succeeded');

    const revenue = (transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalPlatformFees = (transactions || []).reduce((sum, t) => sum + (t.platform_fee_amount || 0), 0);
    const totalStripeFees = (transactions || []).reduce((sum, t) => sum + (t.stripe_fee_amount || 0), 0);

    // Fetch disputes
    const { data: disputes } = await supabase
      .from('stripe_disputes')
      .select('*')
      .eq('merchant_id', merchantId);

    // Fetch escrows
    const { data: escrows } = await supabase
      .from('stripe_escrows')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('status', 'held');

    const pendingEscrowBalance = (escrows || []).reduce((sum, e) => sum + (e.releasable_amount || 0), 0);

    // Get DID reputation
    const { data: merchant } = await supabase
      .from('merchants')
      .select('did')
      .eq('id', merchantId)
      .single();

    let reputation = null;
    if (merchant?.did) {
      reputation = await getCardReputationSummary(supabase, merchant.did);
    }

    return NextResponse.json({
      card_revenue: revenue,
      platform_fees: totalPlatformFees,
      stripe_fees: totalStripeFees,
      net_earnings: revenue - totalPlatformFees - totalStripeFees,
      transaction_count: transactions?.length || 0,
      disputes: {
        total: disputes?.length || 0,
        items: disputes || [],
      },
      escrow: {
        pending_count: escrows?.length || 0,
        pending_balance: pendingEscrowBalance,
      },
      reputation,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
}
