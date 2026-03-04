import { NextRequest, NextResponse } from 'next/server';
import { getMnemonic } from '@/lib/secrets';
import { deriveKeyForChain } from '@/lib/web-wallet/keys';

/**
 * GET /api/escrow/platform-arbiter?chain=ETH
 *
 * Returns CoinPay's platform arbiter public key for the given chain.
 * Uses derivation index 0 from the platform mnemonic (COINPAY_MNEMONIC).
 */
export async function GET(request: NextRequest) {
  const chain = request.nextUrl.searchParams.get('chain');

  if (!chain) {
    return NextResponse.json({ error: 'chain query parameter is required' }, { status: 400 });
  }

  const mnemonic = getMnemonic();
  if (!mnemonic) {
    return NextResponse.json({ error: 'Platform arbiter key not configured' }, { status: 503 });
  }

  try {
    const key = await deriveKeyForChain(mnemonic, chain as any, 0);
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
