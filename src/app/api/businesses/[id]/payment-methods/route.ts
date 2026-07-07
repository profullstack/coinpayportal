import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { authorizeBusiness } from '@/lib/auth/authz';

/**
 * GET /api/businesses/[id]/payment-methods
 *
 * Single source of truth for what a business can be paid with: its active
 * crypto wallets plus whether it can accept cards via Stripe Connect. Used by
 * the invoice flow so the creator (and ultimately the payer) see every accepted
 * method for the business.
 *
 * Authorized by business ROLE (owner, team member, or a matching API key) — not
 * by `businesses.merchant_id`. The old owner-only gate made this route 400 for
 * team members, which the invoice-create UI surfaced as "Card payments are off
 * for this business" and an empty wallet list even when both were configured.
 *
 * Response:
 * {
 *   success: true,
 *   crypto: [{ cryptocurrency, wallet_address }],
 *   card: { enabled: boolean, stripe_account_id: string | null }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const auth = await resolveMerchant(supabase, request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const { merchantId, apiKeyBusinessId } = auth;

    // Authorize read access to this business. API keys are locked to their own
    // business; JWT/team callers must hold a role that grants business.read.
    if (apiKeyBusinessId) {
      if (apiKeyBusinessId !== id) {
        return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
      }
    } else {
      const authz = await authorizeBusiness(supabase, merchantId, id, 'business.read');
      if (!authz.ok) {
        return NextResponse.json({ success: false, error: authz.error }, { status: authz.status });
      }
    }

    // Active crypto wallets for the business.
    const { data: wallets, error: walletError } = await supabase
      .from('business_wallets')
      .select('*')
      .eq('business_id', id)
      .order('cryptocurrency', { ascending: true });
    if (walletError) {
      return NextResponse.json({ success: false, error: walletError.message }, { status: 400 });
    }
    const crypto = (wallets || [])
      .filter((w) => w.is_active !== false)
      .map((w) => ({ cryptocurrency: w.cryptocurrency, wallet_address: w.wallet_address }));

    // Card availability via Stripe Connect (cached charges_enabled flag).
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled')
      .eq('business_id', id)
      .single();

    const card = {
      enabled: !!(stripeAccount?.stripe_account_id && stripeAccount.charges_enabled),
      stripe_account_id: stripeAccount?.stripe_account_id ?? null,
    };

    return NextResponse.json({ success: true, crypto, card });
  } catch (error) {
    console.error('Get payment methods error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
