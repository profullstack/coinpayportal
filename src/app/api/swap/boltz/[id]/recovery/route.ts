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
 * 2026-10-28 (unlock-on-use): keys are now sealed to the wallet's own
 * secp256k1 public key, and this route returns the SEALED blobs. The server
 * cannot open them; the wallet opens them with `openWithWalletKey` from
 * src/lib/swap/sealed-keys.ts using its m/44'/60'/0' account key. A legacy row
 * (an `enc:` blob under ENCRYPTION_KEY, or plaintext) is re-sealed once, on
 * this request, and written back with seal_version 2, unless
 * LEGACY_KEY_MIGRATION=off.
 *
 * This is the missing half of that pair, and it is deliberately its own route
 * rather than extra fields on the status endpoint: returning key material is a
 * distinct action that should be requested explicitly, appear separately in
 * logs, and be rate limited on its own.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeWallet, hasLegacyProviderSecrets, resealLegacyProviderSecrets } from '@/lib/swap/auth';
import { SEAL_SCHEME, SWAP_SEAL_VERSION, isSealed, swapKeyAad } from '@/lib/swap/sealed-keys';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { recordAuditEvent } from '@/lib/audit/log';

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

    const { data: walletRow } = await supabase
      .from('wallets')
      .select('public_key_secp256k1')
      .eq('id', auth.walletId)
      .single();
    const walletPublicKey = (walletRow as { public_key_secp256k1?: string | null } | null)?.public_key_secp256k1 ?? null;

    let providerData = (swap.provider_data ?? {}) as Record<string, unknown>;
    if (walletPublicKey) {
      const resealed = await resealLegacyProviderSecrets(providerData, {
        walletId: auth.walletId,
        swapId: swap.id,
        walletPublicKey,
      });
      if (!resealed.ok) {
        return NextResponse.json({ success: false, error: resealed.error }, { status: 409 });
      }
      if (resealed.changed) {
        const { error: updateError } = await supabase
          .from('swaps')
          .update({ provider_data: resealed.providerData, seal_version: SWAP_SEAL_VERSION })
          .eq('id', swap.id)
          .eq('wallet_id', auth.walletId);
        if (updateError) {
          // Do not hand out a sealed copy the row does not hold yet.
          return NextResponse.json({ success: false, error: 'Could not migrate the swap key; try again' }, { status: 500 });
        }
        providerData = resealed.providerData;
      }
    }

    if (!walletPublicKey && hasLegacyProviderSecrets(providerData)) {
      // Nothing to seal to. The legacy value is kept, not deleted.
      return NextResponse.json(
        { success: false, error: 'This wallet has no secp256k1 key to seal the swap key to; contact support' },
        { status: 409 },
      );
    }

    const sealedRefundKey = isSealed(providerData.refundPrivateKey) ? providerData.refundPrivateKey : null;
    const sealedClaimKey = isSealed(providerData.claimPrivateKey) ? providerData.claimPrivateKey : null;

    if (!sealedRefundKey && !sealedClaimKey) {
      return NextResponse.json(
        { success: false, error: 'This swap has no recoverable key material' },
        { status: 404 },
      );
    }
    const refundPrivateKey = sealedRefundKey;
    const claimPrivateKey = sealedClaimKey;

    // Key material leaving the system is worth a durable record, not only a log
    // line. `docs/SECURITY_KEYS.md` claimed "audit logging for key operations"
    // existed; AUD-01 found it did not. This is that record. The keys
    // themselves are never written — `recordAuditEvent` redacts anything
    // key-shaped as a second line of defence.
    console.warn(
      `[Swap] Recovery keys released for boltz swap ${id} to wallet ${auth.walletId} (status=${swap.status})`
    );

    await recordAuditEvent(supabase, {
      action: 'key.released',
      actorType: 'merchant',
      actorId: auth.walletId,
      subjectType: 'swap',
      subjectId: swap.id,
      detail: {
        provider: 'boltz',
        swap_status: swap.status,
        released: [
          refundPrivateKey ? 'refund' : null,
          claimPrivateKey ? 'claim' : null,
        ].filter(Boolean),
      },
    });

    return NextResponse.json({
      success: true,
      swap_id: swap.id,
      status: swap.status,
      // `redeemScript` / `swapTree` are not secrets — they are needed alongside
      // the key to construct a refund, and are returned as stored.
      redeemScript: providerData.redeemScript ?? null,
      swapTree: providerData.swapTree ?? null,
      // Sealed to this wallet's secp256k1 key; open in the wallet with
      // openWithWalletKey(privateKeySecp256k1, sealed, aad).
      seal: { scheme: SEAL_SCHEME },
      sealedRefundKey,
      sealedClaimKey,
      aad: {
        refund: sealedRefundKey ? swapKeyAad(auth.walletId, swap.id, 'refundPrivateKey') : null,
        claim: sealedClaimKey ? swapKeyAad(auth.walletId, swap.id, 'claimPrivateKey') : null,
      },
    });
  } catch (error) {
    console.error('[Swap] Recovery error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load recovery keys' },
      { status: 500 },
    );
  }
}
