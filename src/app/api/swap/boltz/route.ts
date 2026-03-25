import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getBoltzPairInfo,
  createSwapIn,
  createSwapOut,
  estimateSwapFee,
} from '@/lib/swap/boltz';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const pair = await getBoltzPairInfo();
    return NextResponse.json({ success: true, pair });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get pair info' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { direction, invoice, refundAddress, amountSats, claimAddress, walletId } = body;

    if (direction === 'in') {
      if (!invoice) {
        return NextResponse.json({ success: false, error: 'Lightning invoice required' }, { status: 400 });
      }
      const swap = await createSwapIn(invoice, refundAddress);

      // Save to DB
      if (walletId) {
        const { error: dbError } = await supabase.from('swaps').insert({
          id: swap.id,
          wallet_id: walletId,
          from_coin: 'BTC',
          to_coin: 'LN',
          deposit_amount: swap.expectedAmount ? (swap.expectedAmount / 1e8).toFixed(8) : null,
          deposit_address: swap.address,
          settle_address: 'Lightning Invoice',
          status: 'pending',
          provider: 'boltz',
          provider_data: {
            direction: 'in',
            bip21: swap.bip21,
            expectedAmount: swap.expectedAmount,
            refundPrivateKey: swap.refundPrivateKey,
          },
        });
        if (dbError) console.error('[Boltz] DB save failed:', dbError);
      }

      return NextResponse.json({ success: true, swap });
    } else if (direction === 'out') {
      if (!amountSats || !claimAddress) {
        return NextResponse.json({ success: false, error: 'amountSats and claimAddress required' }, { status: 400 });
      }
      const swap = await createSwapOut(amountSats, claimAddress);

      // Save to DB
      if (walletId) {
        const { error: dbError } = await supabase.from('swaps').insert({
          id: swap.id,
          wallet_id: walletId,
          from_coin: 'LN',
          to_coin: 'BTC',
          deposit_amount: (amountSats / 1e8).toFixed(8),
          settle_amount: swap.onchainAmount ? (swap.onchainAmount / 1e8).toFixed(8) : null,
          deposit_address: 'Lightning Invoice',
          settle_address: claimAddress,
          status: 'pending',
          provider: 'boltz',
          provider_data: {
            direction: 'out',
            invoice: swap.invoice,
            lockupAddress: swap.lockupAddress,
            onchainAmount: swap.onchainAmount,
            claimPrivateKey: swap.claimPrivateKey,
          },
        });
        if (dbError) console.error('[Boltz] DB save failed:', dbError);
      }

      return NextResponse.json({ success: true, swap });
    } else if (direction === 'estimate') {
      if (!amountSats || !body.swapDirection) {
        return NextResponse.json({ success: false, error: 'amountSats and swapDirection required' }, { status: 400 });
      }
      const estimate = await estimateSwapFee(body.swapDirection, amountSats);
      return NextResponse.json({ success: true, estimate });
    } else {
      return NextResponse.json({ success: false, error: 'direction must be "in", "out", or "estimate"' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Swap failed' },
      { status: 500 },
    );
  }
}
