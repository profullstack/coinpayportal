import { NextRequest, NextResponse } from 'next/server';
import { getExchangeRate, getMultipleRates } from '@/lib/rates/tatum';

/**
 * GET /api/rates
 * Get USD exchange rates for cryptocurrencies
 *
 * Query parameters:
 * - coin: Single coin symbol (e.g., "BTC", "ETH")
 * - coins: Comma-separated list of coin symbols
 *
 * Returns rates in USD
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const singleCoin = searchParams.get('coin');
    const multipleCoins = searchParams.get('coins');

    // Single coin request
    if (singleCoin) {
      const coin = singleCoin.toUpperCase();
      
      // Handle stablecoins
      if (coin.startsWith('USDT') || coin.startsWith('USDC')) {
        return NextResponse.json({
          success: true,
          coin,
          rate: 1.0,
          cached: true,
          timestamp: new Date().toISOString(),
        });
      }

      // Get base coin for tokens
      const baseCoin = getBaseCoin(coin);
      const rate = await getExchangeRate(baseCoin, 'USD');

      return NextResponse.json({
        success: true,
        coin,
        rate,
        cached: true,
        timestamp: new Date().toISOString(),
      });
    }

    // Multiple coins request
    if (multipleCoins) {
      const coins = multipleCoins
        .split(',')
        .map(c => c.trim().toUpperCase());

      const rates: Record<string, number> = {};

      for (const coin of coins) {
        try {
          if (coin.startsWith('USDT') || coin.startsWith('USDC')) {
            rates[coin] = 1.0;
          } else {
            const baseCoin = getBaseCoin(coin);
            rates[coin] = await getExchangeRate(baseCoin, 'USD');
          }
        } catch {
          // Skip coins that fail
        }
      }

      return NextResponse.json({
        success: true,
        rates,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { success: false, error: 'Provide coin or coins parameter' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Rates] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch rates',
      },
      { status: 500 }
    );
  }
}

/**
 * Get base coin for tokens (e.g., USDC_ETH -> ETH for rate purposes)
 */
function getBaseCoin(coin: string): string {
  if (coin.endsWith('_ETH')) return 'ETH';
  if (coin.endsWith('_POL')) return 'POL';
  if (coin.endsWith('_SOL')) return 'SOL';
  return coin;
}
