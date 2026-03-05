import { NextRequest, NextResponse } from 'next/server';
import {
  getBoltzPairInfo,
  createSwapIn,
  createSwapOut,
  estimateSwapFee,
} from '@/lib/swap/boltz';

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
    const { direction, invoice, refundAddress, amountSats, claimAddress } = body;

    if (direction === 'in') {
      if (!invoice) {
        return NextResponse.json({ success: false, error: 'Lightning invoice required' }, { status: 400 });
      }
      const swap = await createSwapIn(invoice, refundAddress);
      return NextResponse.json({ success: true, swap });
    } else if (direction === 'out') {
      if (!amountSats || !claimAddress) {
        return NextResponse.json({ success: false, error: 'amountSats and claimAddress required' }, { status: 400 });
      }
      const swap = await createSwapOut(amountSats, claimAddress);
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
