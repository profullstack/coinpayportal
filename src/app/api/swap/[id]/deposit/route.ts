/**
 * POST /api/swap/[id]/deposit
 * Save the deposit transaction hash for a swap
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateWalletRequest } from '@/lib/web-wallet/auth';
import { WalletErrors } from '@/lib/web-wallet/response';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  try {
    const { id } = await params;
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);
    const { txHash } = body;

    if (!id || !txHash) {
      return NextResponse.json(
        { error: 'Missing swap ID or transaction hash' },
        { status: 400 }
      );
    }

    const auth = await authenticateWalletRequest(
      supabase,
      request.headers.get('authorization'),
      request.method,
      request.nextUrl.pathname,
      rawBody
    );
    if (!auth.success || !auth.walletId) {
      return WalletErrors.unauthorized(auth.error);
    }

    // Get current provider_data
    const { data: swap, error: lookupError } = await supabase
      .from('swaps')
      .select('provider_data')
      .eq('id', id)
      .eq('wallet_id', auth.walletId)
      .single();

    if (lookupError || !swap) {
      return NextResponse.json(
        { error: 'Swap not found' },
        { status: 404 }
      );
    }

    // Update provider_data with the tx hash
    const newProviderData = { ...(swap?.provider_data || {}), deposit_tx_hash: txHash };

    const { error } = await supabase
      .from('swaps')
      .update({ provider_data: newProviderData })
      .eq('id', id)
      .eq('wallet_id', auth.walletId);

    if (error) {
      console.error(`[Swap Deposit] DB update failed for ${id}:`, error);
      return NextResponse.json(
        { error: 'Failed to save transaction hash' },
        { status: 500 }
      );
    }

    console.log(`[Swap Deposit] Saved tx hash for ${id}: ${txHash}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Swap Deposit] Error:', error);
    return NextResponse.json(
      { error: 'Failed to save deposit info' },
      { status: 500 }
    );
  }
}
