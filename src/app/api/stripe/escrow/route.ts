import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { releaseEscrow } from '@/lib/stripe/escrow';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/stripe/escrow — Release an escrow
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));

  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { escrow_id } = body;

    if (!escrow_id) {
      return NextResponse.json({ error: 'escrow_id is required' }, { status: 400 });
    }

    // Verify ownership
    const { data: escrow } = await supabase
      .from('stripe_escrows')
      .select('merchant_id')
      .eq('id', escrow_id)
      .single();

    if (!escrow || escrow.merchant_id !== auth.context.merchantId) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }

    // Get merchant's Stripe account
    const { data: stripeAccount } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('merchant_id', auth.context.merchantId)
      .single();

    if (!stripeAccount) {
      return NextResponse.json({ error: 'No Stripe account' }, { status: 400 });
    }

    const result = await releaseEscrow(supabase, escrow_id, stripeAccount.stripe_account_id);
    return NextResponse.json({ success: true, escrow: result.escrow });
  } catch (error) {
    console.error('Escrow release error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Escrow release failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/stripe/escrow — List merchant escrows
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  const auth = await authenticateRequest(supabase, request.headers.get('authorization'));

  if (!auth.success || !auth.context || !isMerchantAuth(auth.context)) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data: escrows, error } = await supabase
    .from('stripe_escrows')
    .select('*')
    .eq('merchant_id', auth.context.merchantId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch escrows' }, { status: 500 });
  }

  return NextResponse.json({ escrows });
}
