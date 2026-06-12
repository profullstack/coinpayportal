import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import { listWallets } from '@/lib/wallets/service';

/**
 * GET /api/businesses/[id]/payment-methods
 *
 * Single source of truth for what a business can be paid with: its active
 * crypto wallets plus whether it can accept cards via Stripe Connect. Used by
 * the invoice flow so the creator (and ultimately the payer) see every accepted
 * method for the business.
 *
 * Response:
 * {
 *   success: true,
 *   crypto: [{ cryptocurrency, wallet_address }],
 *   card: { enabled: boolean, stripe_account_id: string | null }
 * }
 */
async function verifyAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 } as const;
  }
  const token = authHeader.substring(7);
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return { error: 'Server configuration error', status: 500 } as const;
  }
  try {
    const decoded = verifyToken(token, jwtSecret);
    return { merchantId: decoded.userId } as const;
  } catch {
    return { error: 'Invalid or expired token', status: 401 } as const;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await verifyAuth(request);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Active crypto wallets (listWallets verifies the business belongs to the merchant).
    const walletResult = await listWallets(supabase, id, auth.merchantId);
    if (!walletResult.success) {
      return NextResponse.json({ success: false, error: walletResult.error }, { status: 400 });
    }
    const crypto = (walletResult.wallets || [])
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
