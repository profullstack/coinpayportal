import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';
import { getPaypalAccessToken, type PaypalEnvironment } from '@/lib/paypal/client';
import { encryptPaypalSecret } from '@/lib/paypal/accounts';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/paypal/connect
 * Connect a business's own PayPal REST app credentials so it can accept PayPal
 * payments on invoices. Credentials are validated against PayPal (by fetching an
 * access token) before the secret is encrypted and stored.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const businessId = body.business_id || body.businessId;
    const clientId = (body.client_id || body.clientId || '').trim();
    const clientSecret = (body.client_secret || body.clientSecret || '').trim();
    const environment: PaypalEnvironment = body.environment === 'sandbox' ? 'sandbox' : 'live';
    const email = body.email ? String(body.email).trim() : null;

    if (!businessId) {
      return NextResponse.json({ success: false, error: 'business_id is required' }, { status: 400 });
    }
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { success: false, error: 'client_id and client_secret are required' },
        { status: 400 }
      );
    }

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

    // Validate the credentials against PayPal before storing anything.
    try {
      await getPaypalAccessToken({ clientId, clientSecret, environment });
    } catch (err) {
      return NextResponse.json(
        { success: false, error: `Could not validate PayPal credentials: ${err instanceof Error ? err.message : 'unknown error'}` },
        { status: 400 }
      );
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('merchant_id')
      .eq('id', businessId)
      .single();

    const { error: upsertError } = await supabase
      .from('paypal_accounts')
      .upsert(
        {
          merchant_id: business?.merchant_id ?? authResult.merchantId,
          business_id: businessId,
          paypal_client_id: clientId,
          paypal_client_secret_encrypted: encryptPaypalSecret(clientSecret, businessId),
          environment,
          email,
          connected: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'business_id' }
      );

    if (upsertError) {
      console.error('Failed to save PayPal account:', upsertError);
      return NextResponse.json({ success: false, error: 'Failed to save PayPal credentials' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      connected: true,
      environment,
      client_id_last4: clientId.slice(-4),
      email,
    });
  } catch (error) {
    console.error('PayPal connect error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/paypal/connect
 * Disconnect (delete) a business's stored PayPal credentials.
 */
export async function DELETE(request: NextRequest) {
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
      return NextResponse.json({ success: false, error: 'businessId does not match API key scope' }, { status: 403 });
    }
    const access = await verifyBusinessAccess(supabase, businessId, authResult.merchantId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status ?? 404 });
    }

    const { error } = await supabase.from('paypal_accounts').delete().eq('business_id', businessId);
    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to disconnect PayPal' }, { status: 500 });
    }

    // Stop advertising PayPal on any of this business's live invoices.
    await supabase
      .from('invoices')
      .update({ paypal_enabled: false, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .in('status', ['sent', 'overdue']);

    return NextResponse.json({ success: true, connected: false });
  } catch (error) {
    console.error('PayPal disconnect error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
