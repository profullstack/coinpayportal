/**
 * GET /api/swap/coins
 * List supported coins for swaps
 */

import { NextResponse } from 'next/server';
import { SWAP_SUPPORTED_COINS, CN_COIN_MAP } from '@/lib/swap/changenow';

// Coin metadata for display
const COIN_INFO: Record<string, { name: string; network: string }> = {
  'BTC': { name: 'Bitcoin', network: 'Bitcoin' },
  'BCH': { name: 'Bitcoin Cash', network: 'Bitcoin Cash' },
  'ETH': { name: 'Ethereum', network: 'Ethereum' },
  'POL': { name: 'Polygon', network: 'Polygon' },
  'SOL': { name: 'Solana', network: 'Solana' },
  'BNB': { name: 'BNB', network: 'BNB Smart Chain' },
  'DOGE': { name: 'Dogecoin', network: 'Dogecoin' },
  'XRP': { name: 'XRP', network: 'Ripple' },
  'ADA': { name: 'Cardano', network: 'Cardano' },
  'USDT': { name: 'Tether (ETH)', network: 'Ethereum' },
  'USDT_ETH': { name: 'Tether (ETH)', network: 'Ethereum' },
  'USDT_POL': { name: 'Tether (Polygon)', network: 'Polygon' },
  'USDT_SOL': { name: 'Tether (Solana)', network: 'Solana' },
  'USDC': { name: 'USD Coin (ETH)', network: 'Ethereum' },
  'USDC_ETH': { name: 'USD Coin (ETH)', network: 'Ethereum' },
  'USDC_POL': { name: 'USD Coin (Polygon)', network: 'Polygon' },
  'USDC_SOL': { name: 'USD Coin (Solana)', network: 'Solana' },
};

export async function GET() {
  const coins = SWAP_SUPPORTED_COINS.map((symbol) => {
    const info = COIN_INFO[symbol] || { name: symbol, network: 'Unknown' };
    const mapping = CN_COIN_MAP[symbol];
    
    return {
      symbol,
      name: info.name,
      network: info.network,
      ticker: mapping?.ticker || symbol.toLowerCase(),
    };
  });

  return NextResponse.json({
    success: true,
    provider: 'changenow',
    coins,
    count: coins.length,
  });
}
