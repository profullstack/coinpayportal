import { NextRequest, NextResponse } from 'next/server';
import { getExchangeRate, getMultipleRates } from '@/lib/rates/tatum';
import { SUPPORTED_FIAT_CURRENCIES, type FiatCurrency } from '@/lib/web-wallet/settings';

// Valid fiat currency codes
const VALID_FIATS = SUPPORTED_FIAT_CURRENCIES.map(c => c.code);

/**
 * GET /api/rates
 * Get exchange rates for cryptocurrencies
 *
 * Query parameters:
 * - coin: Single coin symbol (e.g., "BTC", "ETH")
 * - coins: Comma-separated list of coin symbols
 * - fiat: Target fiat currency (default: "USD")
 *
 * Returns rates in the specified fiat currency
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const singleCoin = searchParams.get('coin');
    const multipleCoins = searchParams.get('coins');
    const fiatParam = searchParams.get('fiat')?.toUpperCase() || 'USD';

    // Validate fiat currency
    const fiat = VALID_FIATS.includes(fiatParam as FiatCurrency) ? fiatParam : 'USD';

    // Single coin request
    if (singleCoin) {
      const coin = singleCoin.toUpperCase();
      
      // Handle stablecoins (pegged to USD)
      if (coin.startsWith('USDT') || coin.startsWith('USDC')) {
        // For non-USD fiats, convert stablecoin rate
        let rate = 1.0;
        if (fiat !== 'USD') {
          try {
            // Get USD to target fiat rate (via BTC as intermediary)
            const btcUsd = await getExchangeRate('BTC', 'USD');
            const btcFiat = await getExchangeRate('BTC', fiat);
            rate = btcFiat / btcUsd;
          } catch {
            rate = 1.0; // Fallback to 1:1 if conversion fails
          }
        }
        return NextResponse.json({
          success: true,
          coin,
          rate,
          fiat,
          cached: true,
          timestamp: new Date().toISOString(),
        });
      }

      // Get base coin for tokens
      const baseCoin = getBaseCoin(coin);
      const rate = await getExchangeRate(baseCoin, fiat);

      return NextResponse.json({
        success: true,
        coin,
        rate,
        fiat,
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
      let stablecoinRate = 1.0;

      // Pre-calculate stablecoin rate for non-USD fiats
      if (fiat !== 'USD') {
        try {
          const btcUsd = await getExchangeRate('BTC', 'USD');
          const btcFiat = await getExchangeRate('BTC', fiat);
          stablecoinRate = btcFiat / btcUsd;
        } catch {
          // Keep default 1.0
        }
      }

      for (const coin of coins) {
        try {
          if (coin.startsWith('USDT') || coin.startsWith('USDC')) {
            rates[coin] = stablecoinRate;
          } else {
            const baseCoin = getBaseCoin(coin);
            rates[coin] = await getExchangeRate(baseCoin, fiat);
          }
        } catch {
          // Skip coins that fail
        }
      }

      return NextResponse.json({
        success: true,
        rates,
        fiat,
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
