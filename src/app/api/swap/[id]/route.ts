/**
 * GET /api/swap/[id]
 * Get swap transaction status from ChangeNOW
 * Also updates local DB with latest status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSwapStatus } from '@/lib/swap/changenow';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
