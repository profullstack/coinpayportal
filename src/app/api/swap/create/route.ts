/**
 * POST /api/swap/create
 * Create a swap transaction via ChangeNOW
 * 
 * Body:
 *   from: source coin (BTC, ETH, etc.)
 *   to: destination coin
 *   amount: amount to swap
 *   settleAddress: address to receive swapped coins
 *   refundAddress?: address for refunds (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSwap, isSwapSupported, SWAP_SUPPORTED_COINS } from '@/lib/swap/changenow';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, to, amount, settleAddress, refundAddress } = body;

    // Validate required params
    if (!from || !to || !amount || !settleAddress) {
      return NextResponse.json(
        { 
          error: 'Missing required parameters',
          required: ['from', 'to', 'amount', 'settleAddress'],
          optional: ['refundAddress'],
        },
        { status: 400 }
      );
    }

    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();

    // Validate coins
    if (!isSwapSupported(fromUpper)) {
      return NextResponse.json(
        { 
          error: `Unsupported source coin: ${fromUpper}`,
          supported: SWAP_SUPPORTED_COINS 
        },
        { status: 400 }
      );
    }

    if (!isSwapSupported(toUpper)) {
      return NextResponse.json(
        { 
          error: `Unsupported destination coin: ${toUpper}`,
          supported: SWAP_SUPPORTED_COINS 
        },
        { status: 400 }
      );
    }

    if (fromUpper === toUpper) {
      return NextResponse.json(
        { error: 'Cannot swap a coin for itself' },
        { status: 400 }
      );
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount: must be a positive number' },
        { status: 400 }
      );
    }

    // Validate settle address format (basic check)
    if (typeof settleAddress !== 'string' || settleAddress.length < 10) {
      return NextResponse.json(
        { error: 'Invalid settle address' },
        { status: 400 }
      );
    }

    // Create swap via ChangeNOW
    const swap = await createSwap({
      from: fromUpper,
      to: toUpper,
      amount: amount.toString(),
      settleAddress,
      refundAddress,
      quoteId: '', // ChangeNOW doesn't require quoteId for floating rate
    });

    console.log(`[Swap] Created: ${swap.id} - ${fromUpper} → ${toUpper}, deposit to ${swap.depositAddress}`);

    return NextResponse.json({
      success: true,
      swap: {
        id: swap.id,
        from: fromUpper,
        to: toUpper,
        depositAddress: swap.depositAddress,
        depositAmount: swap.depositAmount,
        settleAddress: swap.settleAddress,
        status: swap.status,
        createdAt: swap.createdAt,
        provider: 'changenow',
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[Swap Create] Error:', error);
    
    const message = error instanceof Error ? error.message : 'Failed to create swap';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
