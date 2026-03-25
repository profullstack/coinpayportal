/**
 * POST /api/swap/[id]/deposit
 * Save the deposit transaction hash for a swap
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { txHash } = body;

    if (!id || !txHash) {
      return NextResponse.json(
        { error: 'Missing swap ID or transaction hash' },
        { status: 400 }
      );
    }

    // Get current provider_data
    const { data: swap } = await supabase
      .from('swaps')
      .select('provider_data')
      .eq('id', id)
      .single();

    // Update provider_data with the tx hash
    const newProviderData = { ...(swap?.provider_data || {}), deposit_tx_hash: txHash };

    const { error } = await supabase
      .from('swaps')
      .update({ provider_data: newProviderData })
      .eq('id', id);

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
