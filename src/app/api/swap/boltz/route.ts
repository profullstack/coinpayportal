import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getBoltzPairInfo,
  createSwapIn,
  createSwapOut,
  estimateSwapFee,
} from '@/lib/swap/boltz';
import { authorizeWallet, sealProviderSecrets } from '@/lib/swap/auth';
import { SWAP_SEAL_VERSION } from '@/lib/swap/sealed-keys';
import { validateSecp256k1PublicKey } from '@/lib/web-wallet/identity';
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

    // A wallet may bring its own refund/claim public key; then the private key
    // never exists on our side. Otherwise we generate one and seal it to the
    // wallet's own secp256k1 public key, so no server key can open it.
    const clientKey: string | undefined =
      direction === 'in' ? body.refundPublicKey : direction === 'out' ? body.claimPublicKey : undefined;
    if (clientKey !== undefined && (typeof clientKey !== 'string' || !validateSecp256k1PublicKey(clientKey))) {
      return NextResponse.json(
        { success: false, error: 'refundPublicKey/claimPublicKey must be a 33-byte compressed secp256k1 key (hex)' },
        { status: 400 },
      );
    }
    let walletPublicKey: string | null = null;
    if ((direction === 'in' || direction === 'out') && !clientKey) {
      const { data: walletRow } = await supabase
        .from('wallets')
        .select('public_key_secp256k1')
        .eq('id', walletId)
        .single();
      walletPublicKey = (walletRow as { public_key_secp256k1?: string | null } | null)?.public_key_secp256k1 ?? null;
      // Checked before the swap exists at Boltz: a key we cannot seal must
      // never be minted, or it would be lost.
      if (!walletPublicKey || !validateSecp256k1PublicKey(walletPublicKey)) {
        return NextResponse.json(
          {
            success: false,
            error: 'This wallet has no secp256k1 key to seal swap keys to. Pass refundPublicKey/claimPublicKey from your wallet.',
          },
          { status: 400 },
        );
      }
    }

    if (direction === 'in') {
      if (!invoice) {
        return NextResponse.json({ success: false, error: 'Lightning invoice required' }, { status: 400 });
      }
      const swap = await createSwapIn(invoice, refundAddress, clientKey);

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
          // Key material is sealed to the wallet's own public key; neither a
          // read of the swaps table nor root on the server opens it.
          seal_version: SWAP_SEAL_VERSION,
          provider_data: await sealProviderSecrets(
            {
              direction: 'in',
              bip21: swap.bip21,
              expectedAmount: swap.expectedAmount,
              refundPrivateKey: swap.refundPrivateKey,
              keyCustody: clientKey ? 'client' : 'sealed',
              seal_version: SWAP_SEAL_VERSION,
            },
            { walletId, swapId: swap.id, walletPublicKey: walletPublicKey ?? '' },
          ),
        });
        // A-05: this used to log and answer `success: true`.
        //
        // `refundPrivateKey` is the only thing that can reclaim the funds if the
        // swap fails, and this row is the only place the platform keeps it. A
        // failed insert therefore left a live Boltz swap whose refund key exists
        // nowhere on our side — and told the user everything was fine, so they
        // went ahead and deposited against it.
        //
        // The swap cannot be un-created at Boltz, so the honest answer is not a
        // bare 500 either: that loses the key just as completely. The key is
        // returned so the caller can save it — it is already in the `swap`
        // object on the success path, so this exposes nothing new to the same
        // authenticated caller — and the status code stops the client from
        // treating this as a normal creation.
        if (dbError) {
          console.error('[Boltz] DB save failed — swap-in is live but untracked:', dbError);
          return NextResponse.json(
            {
              success: false,
              tracked: false,
              error:
                'The swap was created at Boltz but could not be recorded. SAVE THE REFUND KEY BELOW before depositing — it is the only way to reclaim your funds if the swap fails, and we were unable to store a copy.',
              swap,
            },
            { status: 500 }
          );
        }
      }

      return NextResponse.json({ success: true, swap });
    } else if (direction === 'out') {
      if (!amountSats || !claimAddress) {
        return NextResponse.json({ success: false, error: 'amountSats and claimAddress required' }, { status: 400 });
      }
      const swap = await createSwapOut(amountSats, claimAddress, clientKey);

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
          seal_version: SWAP_SEAL_VERSION,
          provider_data: await sealProviderSecrets(
            {
              direction: 'out',
              invoice: swap.invoice,
              lockupAddress: swap.lockupAddress,
              onchainAmount: swap.onchainAmount,
              claimPrivateKey: swap.claimPrivateKey,
              keyCustody: clientKey ? 'client' : 'sealed',
              seal_version: SWAP_SEAL_VERSION,
            },
            { walletId, swapId: swap.id, walletPublicKey: walletPublicKey ?? '' },
          ),
        });
        // A-05, reverse direction. `claimPrivateKey` is the only thing that can
        // claim the on-chain side of a swap-out; losing it strands the funds in
        // the lockup with no way to redeem them. Same reasoning as swap-in.
        if (dbError) {
          console.error('[Boltz] DB save failed — swap-out is live but untracked:', dbError);
          return NextResponse.json(
            {
              success: false,
              tracked: false,
              error:
                'The swap was created at Boltz but could not be recorded. SAVE THE CLAIM KEY BELOW — it is the only way to claim the on-chain funds, and we were unable to store a copy.',
              swap,
            },
            { status: 500 }
          );
        }
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
