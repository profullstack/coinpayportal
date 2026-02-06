/**
 * GET /api/swap/[id]
 * Get swap transaction status from ChangeNOW
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSwapStatus } from '@/lib/swap/changenow';

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

    // Get status from ChangeNOW
    const swap = await getSwapStatus(id);

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
