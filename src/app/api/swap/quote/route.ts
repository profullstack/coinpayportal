/**
 * GET /api/swap/quote
 * Get a swap quote from ChangeNOW
 * 
 * Query params:
 *   from: source coin (BTC, ETH, etc.)
 *   to: destination coin
 *   amount: amount to swap
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSwapQuote, isSwapSupported, SWAP_SUPPORTED_COINS } from '@/lib/swap/changenow';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from')?.toUpperCase();
    const to = searchParams.get('to')?.toUpperCase();
    const amount = searchParams.get('amount');

    // Validate required params
    if (!from || !to || !amount) {
      return NextResponse.json(
        { 
          error: 'Missing required parameters',
          required: ['from', 'to', 'amount'],
          example: '/api/swap/quote?from=BTC&to=ETH&amount=0.1'
        },
        { status: 400 }
      );
    }

    // Validate coins
    if (!isSwapSupported(from)) {
      return NextResponse.json(
        { 
          error: `Unsupported source coin: ${from}`,
          supported: SWAP_SUPPORTED_COINS 
        },
        { status: 400 }
      );
    }

    if (!isSwapSupported(to)) {
      return NextResponse.json(
        { 
          error: `Unsupported destination coin: ${to}`,
          supported: SWAP_SUPPORTED_COINS 
        },
        { status: 400 }
      );
    }

    if (from === to) {
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

    // Get quote from ChangeNOW
    const quote = await getSwapQuote({
      from,
      to,
      amount,
    });

    return NextResponse.json({
      success: true,
      quote: {
        from,
        to,
        depositAmount: quote.depositAmount,
        settleAmount: quote.settleAmount,
        rate: quote.rate,
        minAmount: quote.minAmount,
        provider: 'changenow',
      },
    });
  } catch (error) {
    console.error('[Swap Quote] Error:', error);
    
    const message = error instanceof Error ? error.message : 'Failed to get quote';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
