import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { isPaypalPartnerModeEnabled } from '@/lib/paypal/platform';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/paypal/connect/status/[businessId]
 *
 * Report whether a business has PayPal connected, in either mode, and what it
 * can actually do. Never returns the secret.
 *
 * `partner_mode_available` tells the dashboard whether to offer "Connect with
 * PayPal" (onboard through CoinPay) or only the paste-your-own-credentials
 * form — the deployment may not have partner credentials configured.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ businessId: string }> }
) {
  const supabase = getSupabase();
  try {
    const { businessId } = await params;

    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    if (authResult.apiKeyBusinessId && authResult.apiKeyBusinessId !== businessId) {
      return NextResponse.json({ success: false, error: 'businessId does not match API key scope' }, { status: 403 });
    }
    const access = await verifyBusinessAccess(supabase, businessId, authResult.merchantId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const partnerModeAvailable = isPaypalPartnerModeEnabled();

    // One literal, not a concatenation — Supabase parses this string at the type
    // level and falls back to an error type on anything it cannot read.
    const { data: account } = await supabase
      .from('paypal_accounts')
      .select(
        `paypal_client_id, environment, email, connected, created_at, connection_mode,
         merchant_id_in_paypal, payments_receivable, primary_email_confirmed,
         oauth_third_party_granted, scopes, product_status, onboarded_at`
      )
      .eq('business_id', businessId)
      .maybeSingle();

    if (!account) {
      return NextResponse.json({
        success: true,
        connected: false,
        partner_mode_available: partnerModeAvailable,
      });
    }

    const mode = account.connection_mode || 'self_serve';

    // A partner row exists from the moment onboarding starts, so "row exists"
    // is not "connected". Report it as pending so the UI can offer to resume
    // rather than showing a bare disconnected state that loses the in-flight
    // onboarding.
    if (!account.connected) {
      return NextResponse.json({
        success: true,
        connected: false,
        partner_mode_available: partnerModeAvailable,
        connection_mode: mode,
        onboarding_pending: mode === 'partner',
        payments_receivable: !!account.payments_receivable,
        primary_email_confirmed: !!account.primary_email_confirmed,
        oauth_third_party_granted: !!account.oauth_third_party_granted,
        product_status: account.product_status ?? null,
        environment: account.environment,
      });
    }

    return NextResponse.json({
      success: true,
      connected: true,
      partner_mode_available: partnerModeAvailable,
      connection_mode: mode,
      environment: account.environment,
      email: account.email,
      client_id_last4: (account.paypal_client_id || '').slice(-4),
      connected_at: account.created_at,
      onboarded_at: account.onboarded_at ?? null,
      merchant_id_in_paypal: account.merchant_id_in_paypal ?? null,
      payments_receivable: !!account.payments_receivable,
      primary_email_confirmed: !!account.primary_email_confirmed,
      oauth_third_party_granted: !!account.oauth_third_party_granted,
      scopes: account.scopes ?? [],
      product_status: account.product_status ?? null,
      // Self-serve orders are first-party to PayPal, which forbids platform_fees
      // on them. Say so explicitly — this is the commercial difference between
      // the two modes and the dashboard renders it.
      platform_fee_supported: mode === 'partner',
    });
  } catch (error) {
    console.error('PayPal status error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
