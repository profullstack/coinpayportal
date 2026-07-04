import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/paypal/connect/status/[businessId]
 * Report whether a business has PayPal connected. Never returns the secret.
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

    const { data: account } = await supabase
      .from('paypal_accounts')
      .select('paypal_client_id, environment, email, connected, created_at')
      .eq('business_id', businessId)
      .single();

    if (!account || !account.connected) {
      return NextResponse.json({ success: true, connected: false });
    }

    return NextResponse.json({
      success: true,
      connected: true,
      environment: account.environment,
      email: account.email,
      client_id_last4: (account.paypal_client_id || '').slice(-4),
      connected_at: account.created_at,
    });
  } catch (error) {
    console.error('PayPal status error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
