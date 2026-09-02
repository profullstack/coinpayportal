import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { getPaypalBalances } from '@/lib/paypal/client';
import { resolvePaypalContext } from '@/lib/paypal/accounts';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/paypal/balance?business_id=...
 *
 * Read a merchant's PayPal balances — the analogue of GET /api/stripe/balance.
 *
 * The Reporting scope is optional at onboarding, and PayPal only grants balance
 * reads to accounts with it. A merchant who declined gets a 403 from PayPal,
 * which this returns as a 200 with `available: false` and a reason: an empty
 * panel with an explanation is the right outcome, not a failed dashboard.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ success: false, error: 'business_id is required' }, { status: 400 });
    }

    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    if (authResult.apiKeyBusinessId && authResult.apiKeyBusinessId !== businessId) {
      return NextResponse.json(
        { success: false, error: 'businessId does not match API key scope' },
        { status: 403 }
      );
    }
    const access = await verifyBusinessAccess(supabase, businessId, authResult.merchantId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const context = await resolvePaypalContext(supabase, businessId);
    if ('error' in context) {
      return NextResponse.json({ success: false, error: context.error }, { status: context.status });
    }

    try {
      const balances = await getPaypalBalances({
        ...context.creds,
        ...context.callContext,
        currency: searchParams.get('currency') || undefined,
      });
      return NextResponse.json({ success: true, available: true, balances });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[PayPal] Balance read failed:', message);
      return NextResponse.json({
        success: true,
        available: false,
        balances: [],
        reason: /403|NOT_AUTHORIZED|PERMISSION/i.test(message)
          ? 'This PayPal account has not granted CoinPay permission to read its balance.'
          : 'PayPal did not return a balance for this account.',
      });
    }
  } catch (error) {
    console.error('PayPal balance error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
