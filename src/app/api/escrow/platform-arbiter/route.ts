import { NextRequest, NextResponse } from 'next/server';
import { getMnemonic } from '@/lib/secrets';
import { deriveKeyForChain } from '@/lib/web-wallet/keys';
import { PLATFORM_ARBITER_DERIVATION_INDEX } from '@/lib/wallets/derivation-family';
import { isRetiredMnemonic } from '@/lib/wallets/key-generation';
import { OperatorKeysLockedError, readSystemMnemonicVar, refreshOperatorState } from '@/lib/wallets/operator-keys';

function getSystemMnemonic(chain: string): string | undefined {
  // Try exact chain first (e.g. SYSTEM_MNEMONIC_USDC_ETH), then fall back to
  // COINPAY_MNEMONIC. Sealed operator keys: from the operator unlock only.
  return readSystemMnemonicVar(`SYSTEM_MNEMONIC_${chain}`) || getMnemonic();
}

/**
 * GET /api/escrow/platform-arbiter?chain=ETH
 *
 * Returns CoinPay's platform arbiter public key for the given chain.
 *
 * ESC-NEW-14: the index is now a named reservation rather than a bare `0`.
 * It is the same system mnemonic the payment and escrow addresses derive from,
 * and the family counter used to start at 0 on an empty chain — so the first
 * payment address ever created derived the very key the arbiter signs disputes
 * with. `acquireFamilyIndex` now skips this index, so the two key spaces cannot
 * meet.
 */
export async function GET(request: NextRequest) {
  const chain = request.nextUrl.searchParams.get('chain');

  if (!chain) {
    return NextResponse.json({ error: 'chain query parameter is required' }, { status: 400 });
  }

  let mnemonic: string | undefined;
  try {
    await refreshOperatorState();
    mnemonic = getSystemMnemonic(chain);
  } catch (err) {
    if (err instanceof OperatorKeysLockedError) {
      return NextResponse.json({ error: 'Platform arbiter key unavailable: CoinPay operator keys are locked', code: 'operator_locked' }, { status: 503 });
    }
    throw err;
  }
  if (!mnemonic || isRetiredMnemonic(mnemonic)) {
    // A retired (leaked) seed must never hand out an arbiter key for a new escrow.
    return NextResponse.json({ error: `Platform arbiter key not configured for ${chain}` }, { status: 503 });
  }

  try {
    const key = await deriveKeyForChain(mnemonic, chain as any, PLATFORM_ARBITER_DERIVATION_INDEX);
    return NextResponse.json({
      success: true,
      chain,
      pubkey: key.publicKey,
      address: key.address,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to derive arbiter key' }, { status: 400 });
  }
}
