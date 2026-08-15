/**
 * GET /api/swap/[id]
 * Get swap transaction status from ChangeNOW
 * Also updates local DB with latest status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSwapStatus } from '@/lib/swap/changenow';
import { createClient } from '@supabase/supabase-js';
import { authorizeWallet } from '@/lib/swap/auth';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}


/**
 * Confirm the authenticated wallet owns this swap.
 *
 * A swap id is handed to the payer and echoed in URLs, so possession of it is
 * not authorization to read or mutate the swap.
 */
async function requireSwapOwner(
  supabase: ReturnType<typeof getSupabase>,
  request: NextRequest,
  swapId: string,
  body?: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const auth = await authorizeWallet(supabase, request, body);
  if (!auth.ok) return auth;

  const { data: swap } = await supabase
    .from('swaps')
    .select('wallet_id')
    .eq('id', swapId)
    .single();

  if (!swap || swap.wallet_id !== auth.walletId) {
    // Same response for "no such swap" and "not yours", so the endpoint is not
    // an existence oracle for other wallets' swap ids.
    return { ok: false, status: 404, error: 'Swap not found' };
  }

  return { ok: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing swap ID' },
        { status: 400 }
      );
    }

    // Basic sanity check — reject obviously invalid IDs
    if (id.length < 6 || id.length > 128 || /\s/.test(id)) {
      return NextResponse.json(
        { error: 'Invalid swap ID format' },
        { status: 400 }
      );
    }

    const owner = await requireSwapOwner(supabase, request, id);
    if (!owner.ok) {
      return NextResponse.json({ error: owner.error }, { status: owner.status });
    }

    // Get status from ChangeNOW
    const swap = await getSwapStatus(id);

    // Update local DB with latest status (non-blocking)
    supabase
      .from('swaps')
      .update({
        status: swap.status,
        settle_amount: swap.settleAmount || undefined,
      })
      .eq('id', id)
      .then(({ error }) => {
        if (error) {
          console.error(`[Swap Status] DB update failed for ${id}:`, error);
        }
      });

    return NextResponse.json({
      success: true,
      swap: {
        id: swap.id,
        depositAddress: swap.depositAddress,
        depositCoin: swap.depositCoin,
        depositAmount: swap.depositAmount,
        settleCoin: swap.settleCoin,
        settleAddress: swap.settleAddress,
        settleAmount: swap.settleAmount,
        status: swap.status,
        createdAt: swap.createdAt,
        provider: 'changenow',
      },
    });
  } catch (error) {
    console.error('[Swap Status] Error:', error);
    
    const message = error instanceof Error ? error.message : 'Failed to get swap status';
    
    // Check if it's a not found error
    if (message.includes('not found') || message.includes('404')) {
      return NextResponse.json(
        { error: 'Swap not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
