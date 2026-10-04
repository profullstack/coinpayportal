import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { getPaypalPlatformConfig } from '@/lib/paypal/platform';
import { createPartnerReferral, getMerchantIntegration } from '@/lib/paypal/partner';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/paypal/connect/onboard
 *
 * Start PayPal partner onboarding for a business — the analogue of
 * POST /api/stripe/connect/onboard. Returns an `url` the merchant must visit;
 * they sign in to their own PayPal account there and grant CoinPay third-party
 * permissions, then PayPal returns them to /businesses/{id}?paypal=connected.
 *
 * The row is written in partner mode UP FRONT, before the merchant has finished,
 * with payments_receivable=false. That matters: the return leg and the
 * MERCHANT.ONBOARDING.COMPLETED webhook both need a row to attach the resulting
 * merchant_id_in_paypal to, and whichever arrives first should find one.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json().catch(() => ({}));
    const businessId = body.business_id || body.businessId;

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
    const access = await verifyBusinessAccess(supabase, businessId, authResult.merchantId, 'settings.manage');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const config = getPaypalPlatformConfig();
    if (!config) {
      return NextResponse.json(
        {
          success: false,
          error:
            'PayPal partner onboarding is not available on this server. Connect your own PayPal REST credentials instead.',
        },
        { status: 503 }
      );
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('merchant_id, name')
      .eq('id', businessId)
      .single();

    // Refuse to overwrite a working self-serve connection with a half-finished
    // partner one. Disconnecting is an explicit, separate action.
    const { data: existing } = await supabase
      .from('paypal_accounts')
      .select('connection_mode, connected, merchant_id_in_paypal')
      .eq('business_id', businessId)
      .maybeSingle();

    if (existing?.connected && existing.connection_mode === 'self_serve') {
      return NextResponse.json(
        {
          success: false,
          error:
            'This business already has PayPal connected with its own credentials. Disconnect it first to onboard through CoinPay instead.',
        },
        { status: 409 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
    const merchantEmail = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;

    let referral;
    try {
      referral = await createPartnerReferral({
        config,
        trackingId: businessId,
        returnUrl: `${appUrl}/businesses/${businessId}?paypal=connected`,
        email: merchantEmail,
      });
    } catch (err) {
      console.error('[PayPal] Partner referral failed:', err);
      return NextResponse.json(
        {
          success: false,
          error: `Could not start PayPal onboarding: ${err instanceof Error ? err.message : 'unknown error'}`,
        },
        { status: 502 }
      );
    }

    const { error: upsertError } = await supabase.from('paypal_accounts').upsert(
      {
        merchant_id: business?.merchant_id ?? authResult.merchantId,
        business_id: businessId,
        connection_mode: 'partner',
        tracking_id: businessId,
        partner_referral_id: referral.referralId,
        environment: config.environment,
        email: merchantEmail,
        // Not connected until PayPal tells us the merchant can receive payments.
        connected: false,
        payments_receivable: false,
        primary_email_confirmed: false,
        // A partner row carries no credentials of its own; null them out so a
        // re-onboard after a self-serve disconnect can't leave a stale secret.
        paypal_client_id: null,
        paypal_client_secret_encrypted: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id' }
    );

    if (upsertError) {
      console.error('[PayPal] Failed to record onboarding start:', upsertError);
      return NextResponse.json(
        { success: false, error: 'Failed to record PayPal onboarding' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: referral.actionUrl,
      referral_id: referral.referralId,
      environment: config.environment,
    });
  } catch (error) {
    console.error('PayPal onboard error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/paypal/connect/onboard
 *
 * Finish onboarding by pulling the merchant's current integration state from
 * PayPal and writing it to the row. Called by the dashboard when the merchant
 * lands back on ?paypal=connected, so the UI flips to connected without waiting
 * for the webhook (which can lag by minutes, and is not guaranteed to arrive
 * before the merchant looks).
 */
export async function PATCH(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json().catch(() => ({}));
    const businessId = body.business_id || body.businessId;

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
    const access = await verifyBusinessAccess(supabase, businessId, authResult.merchantId, 'settings.manage');
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const config = getPaypalPlatformConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, error: 'PayPal partner mode is not configured' },
        { status: 503 }
      );
    }

    const { data: account } = await supabase
      .from('paypal_accounts')
      .select('connection_mode, merchant_id_in_paypal, tracking_id')
      .eq('business_id', businessId)
      .maybeSingle();

    if (!account || account.connection_mode !== 'partner') {
      return NextResponse.json(
        { success: false, error: 'This business is not onboarding through CoinPay' },
        { status: 409 }
      );
    }

    // PayPal accepts either its own merchant id or our tracking id here. Prefer
    // the merchant id once we have one; the tracking id is how we find them the
    // first time, before we know it.
    const lookupId =
      account.merchant_id_in_paypal ||
      // The return leg carries merchantIdInPayPal on the query string. Trusting
      // it directly would let anyone bind an arbitrary PayPal account to a
      // business they control, so it is only ever a LOOKUP key — the values we
      // store come from PayPal's own response below.
      (typeof body.merchant_id_in_paypal === 'string' && body.merchant_id_in_paypal.trim()) ||
      account.tracking_id ||
      businessId;

    let integration;
    try {
      integration = await getMerchantIntegration({ config, merchantIdOrTrackingId: lookupId });
    } catch (err) {
      console.error('[PayPal] Integration lookup failed:', err);
      return NextResponse.json(
        { success: false, error: 'Could not read onboarding status from PayPal' },
        { status: 502 }
      );
    }

    if (!integration) {
      return NextResponse.json({
        success: true,
        connected: false,
        pending: true,
        message: 'PayPal has no record of this onboarding yet.',
      });
    }

    // PayPal ties the integration to OUR tracking id. If what comes back is for
    // a different business, someone is trying to bind an account they onboarded
    // elsewhere — refuse rather than write it.
    if (integration.trackingId && integration.trackingId !== businessId) {
      console.warn('[PayPal] Tracking id mismatch on finish', {
        businessId,
        returned: integration.trackingId,
      });
      return NextResponse.json(
        { success: false, error: 'This PayPal onboarding belongs to a different business' },
        { status: 409 }
      );
    }

    const receivable = integration.paymentsReceivable && integration.oauthThirdPartyGranted;

    const { error: updateError } = await supabase
      .from('paypal_accounts')
      .update({
        merchant_id_in_paypal: integration.merchantIdInPaypal,
        email: integration.email,
        payments_receivable: integration.paymentsReceivable,
        primary_email_confirmed: integration.primaryEmailConfirmed,
        oauth_third_party_granted: integration.oauthThirdPartyGranted,
        scopes: integration.scopes,
        product_status: integration.productStatus,
        connected: receivable,
        onboarded_at: receivable ? new Date().toISOString() : null,
        last_status_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('business_id', businessId);

    if (updateError) {
      console.error('[PayPal] Failed to persist onboarding status:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to save PayPal onboarding status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      connected: receivable,
      payments_receivable: integration.paymentsReceivable,
      primary_email_confirmed: integration.primaryEmailConfirmed,
      oauth_third_party_granted: integration.oauthThirdPartyGranted,
      merchant_id_in_paypal: integration.merchantIdInPaypal,
      product_status: integration.productStatus,
      scopes: integration.scopes,
    });
  } catch (error) {
    console.error('PayPal onboard finish error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
