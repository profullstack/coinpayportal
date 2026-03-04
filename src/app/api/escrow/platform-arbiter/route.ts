import { NextRequest, NextResponse } from 'next/server';
import { getMnemonic } from '@/lib/secrets';
import { deriveKeyForChain } from '@/lib/web-wallet/keys';

// Map chains to their parent chain for mnemonic lookup (e.g. USDC_ETH → ETH)
const CHAIN_TO_MNEMONIC_KEY: Record<string, string> = {
  BTC: 'BTC',
  BCH: 'BTC',
  DOGE: 'BTC',
  ETH: 'ETH',
  BNB: 'ETH',
  USDC_ETH: 'ETH',
  USDT_ETH: 'ETH',
  POL: 'POL',
  USDC_POL: 'POL',
  USDT_POL: 'POL',
  SOL: 'SOL',
  USDC_SOL: 'SOL',
  XRP: 'ETH',
  ADA: 'ETH',
};

function getSystemMnemonic(chain: string): string | undefined {
  const key = CHAIN_TO_MNEMONIC_KEY[chain] || chain;
  // Try chain-specific first, then fall back to COINPAY_MNEMONIC
  return (
    process.env[`SYSTEM_MNEMONIC_${key}`] ||
    getMnemonic()
  );
}

/**
 * GET /api/escrow/platform-arbiter?chain=ETH
 *
 * Returns CoinPay's platform arbiter public key for the given chain.
 * Uses derivation index 0 from the system mnemonic for that chain.
 */
export async function GET(request: NextRequest) {
  const chain = request.nextUrl.searchParams.get('chain');

  if (!chain) {
    return NextResponse.json({ error: 'chain query parameter is required' }, { status: 400 });
  }

  const mnemonic = getSystemMnemonic(chain);
  if (!mnemonic) {
    return NextResponse.json({ error: `Platform arbiter key not configured for ${chain}` }, { status: 503 });
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
