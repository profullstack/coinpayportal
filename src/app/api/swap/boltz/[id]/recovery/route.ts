/**
 * GET /api/swap/boltz/:id/recovery
 *
 * Hand the owning wallet the refund and claim keys for one Boltz swap.
 *
 * A-03: `encryptProviderSecrets` is called when a Boltz swap is created and
 * `stripProviderSecrets` when swap history is listed, but
 * `decryptProviderSecrets` had **zero callers**. The keys went in and never came
 * back out, so when a swap failed — expired, lockup failed, invoice unpayable —
 * the HTLC funds could not be recovered through the product at all. The refund
 * path exists on Boltz's side; the key needed to walk it was locked in our
 * database.
 *
 * This is the missing half of that pair, and it is deliberately its own route
 * rather than extra fields on the status endpoint: returning key material is a
 * distinct action that should be requested explicitly, appear separately in
 * logs, and be rate limited on its own.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeWallet, decryptProviderSecrets } from '@/lib/swap/auth';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = getSupabase();
  try {
    const { id } = await params;

    const auth = await authorizeWallet(supabase, request);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const rate = await checkRateLimitAsync(auth.walletId, 'swap_recovery');
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many recovery requests. Please try again shortly.' },
        { status: 429 },
      );
    }

    const { data: swap } = await supabase
      .from('swaps')
      .select('id, wallet_id, provider, status, provider_data')
      .eq('id', id)
      .eq('provider', 'boltz')
      .single();

    // Same response for "no such swap" and "not yours", so this is not an
    // existence oracle for other wallets' swap ids.
    if (!swap || swap.wallet_id !== auth.walletId) {
      return NextResponse.json({ success: false, error: 'Swap not found' }, { status: 404 });
    }

    const providerData = (swap.provider_data ?? {}) as Record<string, unknown>;
    const decrypted = decryptProviderSecrets(providerData);

    const refundPrivateKey = typeof decrypted.refundPrivateKey === 'string' ? decrypted.refundPrivateKey : null;
    const claimPrivateKey = typeof decrypted.claimPrivateKey === 'string' ? decrypted.claimPrivateKey : null;

    if (!refundPrivateKey && !claimPrivateKey) {
      return NextResponse.json(
        { success: false, error: 'This swap has no recoverable key material' },
        { status: 404 },
      );
    }

    // Key material leaving the system is worth a log line on its own, even
    // though the request is authorized. The keys themselves are never logged.
    console.warn(
      `[Swap] Recovery keys released for boltz swap ${id} to wallet ${auth.walletId} (status=${swap.status})`
    );

    return NextResponse.json({
      success: true,
      swap_id: swap.id,
      status: swap.status,
      // `redeemScript` / `swapTree` are not secrets — they are needed alongside
      // the key to construct a refund, and are returned as stored.
      redeemScript: decrypted.redeemScript ?? null,
      swapTree: decrypted.swapTree ?? null,
      refundPrivateKey,
      claimPrivateKey,
    });
  } catch (error) {
    console.error('[Swap] Recovery error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load recovery keys' },
      { status: 500 },
    );
  }
}
