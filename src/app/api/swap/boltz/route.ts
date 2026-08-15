import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getBoltzPairInfo,
  createSwapIn,
  createSwapOut,
  estimateSwapFee,
} from '@/lib/swap/boltz';
import { authorizeWallet, encryptProviderSecrets } from '@/lib/swap/auth';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

function getSupabase() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = getSupabase();
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
  const supabase = getSupabase();
  try {
    // Read the raw body once so the signature can be verified over it, then
    // parse. This endpoint moves real funds and mints refund/claim keys, so it
    // was never safe to leave unauthenticated.
    const rawBody = await request.text();

    const auth = await authorizeWallet(supabase, request, rawBody);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    // The wallet id is the authenticated one; a body-supplied walletId is
    // ignored so a caller cannot file a swap under someone else's wallet.
    const walletId = auth.walletId;

    const rateCheck = await checkRateLimitAsync(walletId, 'swap_read');
    if (!rateCheck.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const { direction, invoice, refundAddress, amountSats, claimAddress } = body;

    if (direction === 'in') {
      if (!invoice) {
        return NextResponse.json({ success: false, error: 'Lightning invoice required' }, { status: 400 });
      }
      const swap = await createSwapIn(invoice, refundAddress);

      // Save to DB
      {
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
          // Key material is encrypted at rest; a read of the swaps table no
          // longer yields the key that redeems the swap.
          provider_data: encryptProviderSecrets({
            direction: 'in',
            bip21: swap.bip21,
            expectedAmount: swap.expectedAmount,
            refundPrivateKey: swap.refundPrivateKey,
          }),
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
      {
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
          provider_data: encryptProviderSecrets({
            direction: 'out',
            invoice: swap.invoice,
            lockupAddress: swap.lockupAddress,
            onchainAmount: swap.onchainAmount,
            claimPrivateKey: swap.claimPrivateKey,
          }),
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
