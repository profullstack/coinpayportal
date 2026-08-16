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
 *
 * The wallet is taken from the authenticated request, not the body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSwap, isSwapSupported, SWAP_SUPPORTED_COINS } from '@/lib/swap/changenow';
import { createClient } from '@supabase/supabase-js';
import { authorizeWallet } from '@/lib/swap/auth';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const rawBody = await request.text();

    // A valid token proved who the caller is; it did not prove they own the
    // `walletId` they put in the body. The swap is now always filed under the
    // authenticated wallet.
    const auth = await authorizeWallet(supabase, request, rawBody);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const walletId = auth.walletId;

    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
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
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
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

    // Save swap to database for history tracking
    const { error: dbError } = await supabase
      .from('swaps')
      .insert({
        id: swap.id,
        wallet_id: walletId,
        from_coin: fromUpper,
        to_coin: toUpper,
        deposit_amount: swap.depositAmount,
        settle_amount: swap.settleAmount || null,
        deposit_address: swap.depositAddress,
        settle_address: swap.settleAddress,
        refund_address: refundAddress || null,
        status: swap.status,
        provider: 'changenow',
        provider_data: {
          depositCoin: swap.depositCoin,
          depositNetwork: swap.depositNetwork,
          settleCoin: swap.settleCoin,
          settleNetwork: swap.settleNetwork,
        },
      });

    if (dbError) {
      console.error('[Swap] DB save failed (swap still created):', dbError);
      // Don't fail the request - swap was created successfully
    }

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
