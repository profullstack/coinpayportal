import { NextResponse } from 'next/server';
import { DERIVABLE_CHAINS, DERIVABLE_CHAIN_INFO } from '@/lib/web-wallet/keys';

/**
 * GET /api/web-wallet/supported-chains
 * 
 * Returns the list of chains that can be derived from a BIP39 mnemonic.
 * This is the single source of truth for what chains the web wallet supports.
 * 
 * Response:
 * {
 *   chains: ['BTC', 'BCH', ...],
 *   chainInfo: { BTC: { name: 'Bitcoin', symbol: 'BTC' }, ... }
 * }
 */
export async function GET() {
  return NextResponse.json({
    chains: DERIVABLE_CHAINS,
    chainInfo: DERIVABLE_CHAIN_INFO,
  });
}
