import { NextRequest, NextResponse } from 'next/server';
import { guardBankDataRequest } from '@/lib/bankdata/guard';
import { BankDataError } from '@/lib/bankdata';
import { reconcileBusiness } from '@/lib/bankdata/service';

/**
 * GET /api/bankdata/reconcile?business_id=…&from=…&to=…
 *
 * Answer "CoinPay says it paid me — did the money arrive?" by pairing expected fiat
 * settlements with bank credits.
 *
 * Expect empty results today: the only settlement source is `stripe_payouts`, which has
 * no rows in production, and the Stripe Connect account is terminated. The endpoint is
 * here because the matcher is the part worth having ready — when a crypto off-ramp
 * lands, its payouts become a second source and this starts returning matches.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    const guard = await guardBankDataRequest(
      request.headers.get('authorization'),
      businessId,
      'business.read',
    );
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }

    // `stripe_payouts` is keyed by the OWNING merchant, not by the caller — a team
    // member reconciling must see the business owner's payouts, not their own.
    const { data: business } = await guard.supabase
      .from('businesses')
      .select('merchant_id')
      .eq('id', businessId as string)
      .maybeSingle();

    const merchantId = (business as { merchant_id?: string } | null)?.merchant_id;
    if (!merchantId) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    const result = await reconcileBusiness(guard.supabase, {
      businessId: businessId as string,
      merchantId,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
    });

    return NextResponse.json({
      success: true,
      matched: result.matched,
      unmatched_settlements: result.unmatchedSettlements,
      unmatched_credits: result.unmatchedCredits,
    });
  } catch (error) {
    if (error instanceof BankDataError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
    console.error('Error reconciling bank data:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
