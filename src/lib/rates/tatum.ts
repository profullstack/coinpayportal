/**
 * Exchange Rate Service
 * Provides real-time cryptocurrency exchange rates
 *
 * Primary: Tatum API (requires TATUM_API_KEY)
 * Fallback: Kraken API (free, no API key required)
 *
 * Note: Tatum returns NaN for POL/MATIC, so Kraken is used for Polygon
 */

const TATUM_API_BASE = 'https://api.tatum.io';
const KRAKEN_API_BASE = 'https://api.kraken.com/0/public';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Map internal cryptocurrency symbols to Kraken trading pairs
 * Kraken uses specific pair formats like BTCUSD, ETHUSD, POLUSD
 */
const KRAKEN_PAIR_MAP: Record<string, string> = {
  'BTC': 'XBTUSD',
  'ETH': 'ETHUSD',
  'SOL': 'SOLUSD',
  'POL': 'POLUSD',
  'MATIC': 'POLUSD',
  'BCH': 'BCHUSD',
  'USDC': 'USDCUSD',
  'USDT': 'USDTUSD',
  'DOGE': 'XDGUSD',
  'XRP': 'XXRPZUSD',
  'ADA': 'ADAUSD',
  'BNB': 'BNBUSD',
};

/**
 * Currencies that should use Kraken (Tatum returns NaN for these)
 */
/**
 * Currencies routed directly to Kraken (free, no rate limit).
 * Tatum is only used for chains NOT in KRAKEN_PAIR_MAP.
 */
const USE_KRAKEN = Object.keys(KRAKEN_PAIR_MAP).concat([
  'USDC_POL', 'USDC_MATIC', 'USDT_ETH', 'USDT_SOL', 'USDT_POL', 'USDC_ETH', 'USDC_SOL',
]);

/**
 * Rate cache to minimize API calls
 */
interface CachedRate {
  value: number;
  timestamp: number;
}

const rateCache = new Map<string, CachedRate>();

/**
 * Get Tatum API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY environment variable is not set');
  }
  return apiKey;
}

/**
 * Check if cached rate is still valid
 */
function isCacheValid(cached: CachedRate): boolean {
  return Date.now() - cached.timestamp < CACHE_TTL;
}

/**
 * Get cache key for a currency pair
 */
function getCacheKey(from: string, to: string): string {
  return `${from.toUpperCase()}_${to.toUpperCase()}`;
}

/**
 * Fetch exchange rate from Kraken API (free, no API key required)
 *
 * @param from - Source cryptocurrency (BTC, ETH, SOL, POL, etc.)
 * @param to - Target fiat currency (USD, EUR, etc.)
 * @returns Exchange rate value
 */
async function getExchangeRateFromKraken(
  from: string,
  to: string
): Promise<number> {
  // Kraken only supports USD pairs in our implementation
  if (to.toUpperCase() !== 'USD') {
    throw new Error(`Kraken fallback only supports USD pairs, got: ${to}`);
  }

  const krakenPair = KRAKEN_PAIR_MAP[from.toUpperCase()];
  if (!krakenPair) {
    throw new Error(`Unknown cryptocurrency for Kraken: ${from}`);
  }

  const url = `${KRAKEN_API_BASE}/Ticker?pair=${krakenPair}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Kraken API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  
  // Check for Kraken API errors
  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken API error: ${data.error.join(', ')}`);
  }

  // Kraken returns data in result object with the pair as key
  // The 'c' field contains [price, lot_volume] for last trade
  const pairData = data.result?.[krakenPair];
  const rate = parseFloat(pairData?.c?.[0]);

  if (typeof rate !== 'number' || isNaN(rate) || rate <= 0) {
    throw new Error(`Invalid rate received from Kraken API: ${JSON.stringify(data)}`);
  }

  return rate;
}

/**
 * Fetch exchange rate from Tatum API
 * @param from - Source cryptocurrency (BTC, ETH, SOL, POL, etc.)
 * @param to - Target fiat currency (USD, EUR, etc.)
 * @returns Exchange rate value
 */
// Simple rate limiter for Tatum (3 req/sec free tier)
let lastTatumCall = 0;
const TATUM_MIN_INTERVAL = 350; // ms between calls (~2.8/sec, safe margin)

async function getExchangeRateFromTatum(
  from: string,
  to: string
): Promise<number> {
  // Throttle to stay under 3 req/sec
  const now = Date.now();
  const elapsed = now - lastTatumCall;
  if (elapsed < TATUM_MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, TATUM_MIN_INTERVAL - elapsed));
  }
  lastTatumCall = Date.now();

  const apiKey = getApiKey();
  const url = `${TATUM_API_BASE}/v3/tatum/rate/${from.toUpperCase()}?basePair=${to.toUpperCase()}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Tatum API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  
  // Tatum API may return rate as string or number
  const rate = typeof data.value === 'string'
    ? parseFloat(data.value)
    : data.value;

  if (typeof rate !== 'number' || isNaN(rate) || rate <= 0) {
    throw new Error(`Invalid rate received from Tatum API: ${data.value}`);
  }

  return rate;
}

/**
 * Fetch exchange rate with automatic provider selection
 *
 * Provider selection:
 * - POL/MATIC: Always uses Kraken (Tatum returns NaN)
 * - Other cryptos: Uses Tatum, falls back to Kraken on error
 *
 * @param from - Source cryptocurrency (BTC, ETH, SOL, POL, etc.)
 * @param to - Target fiat currency (USD, EUR, etc.)
 * @returns Exchange rate value
 */
export async function getExchangeRate(
  from: string,
  to: string
): Promise<number> {
  try {
    // Check cache first
    const cacheKey = getCacheKey(from, to);
    const cached = rateCache.get(cacheKey);
    
    if (cached && isCacheValid(cached)) {
      return cached.value;
    }

    let rate: number;
    const upperFrom = from.toUpperCase();

    // Use Kraken for POL/MATIC (Tatum returns NaN for these)
    if (USE_KRAKEN.includes(upperFrom)) {
      // For USDC on Polygon, get USDC rate
      const symbol = upperFrom.startsWith('USDC_') ? 'USDC' : upperFrom.startsWith('USDT_') ? 'USDT' : from;
      rate = await getExchangeRateFromKraken(symbol, to);
    } else {
      // Try Tatum first, fall back to Kraken on error
      try {
        rate = await getExchangeRateFromTatum(from, to);
      } catch (tatumError) {
        console.warn(`Tatum API failed for ${from}/${to}, falling back to Kraken:`,
          tatumError instanceof Error ? tatumError.message : tatumError);
        rate = await getExchangeRateFromKraken(from, to);
      }
    }

    // Cache the result
    rateCache.set(cacheKey, {
      value: rate,
      timestamp: Date.now(),
    });

    return rate;
  } catch (error) {
    throw new Error(
      `Failed to fetch exchange rate for ${from}/${to}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Get multiple exchange rates at once
 * @param currencies - Array of cryptocurrency symbols
 * @param fiat - Target fiat currency
 * @returns Object mapping currency to rate
 */
export async function getMultipleRates(
  currencies: string[],
  fiat: string
): Promise<Record<string, number>> {
  if (currencies.length === 0) {
    return {};
  }

  try {
    const rates = await Promise.all(
      currencies.map(async (currency) => {
        const rate = await getExchangeRate(currency, fiat);
        return [currency, rate] as [string, number];
      })
    );

    return Object.fromEntries(rates);
  } catch (error) {
    throw new Error(
      `Failed to fetch multiple rates: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Calculate cryptocurrency amount from fiat amount
 * @param fiatAmount - Amount in fiat currency
 * @param fiatCurrency - Fiat currency code (USD, EUR, etc.)
 * @param cryptoCurrency - Cryptocurrency code (BTC, ETH, etc.)
 * @returns Amount in cryptocurrency
 */
export async function getCryptoPrice(
  fiatAmount: number,
  fiatCurrency: string,
  cryptoCurrency: string
): Promise<number> {
  if (fiatAmount <= 0) {
    throw new Error('Fiat amount must be greater than zero');
  }

  try {
    const rate = await getExchangeRate(cryptoCurrency, fiatCurrency);
    const cryptoAmount = fiatAmount / rate;
    
    // Round to 8 decimal places (standard for crypto)
    return Math.round(cryptoAmount * 100000000) / 100000000;
  } catch (error) {
    throw new Error(
      `Failed to calculate crypto price: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Calculate fiat amount from cryptocurrency amount
 * @param cryptoAmount - Amount in cryptocurrency
 * @param cryptoCurrency - Cryptocurrency code (BTC, ETH, etc.)
 * @param fiatCurrency - Fiat currency code (USD, EUR, etc.)
 * @returns Amount in fiat currency
 */
export async function getFiatPrice(
  cryptoAmount: number,
  cryptoCurrency: string,
  fiatCurrency: string
): Promise<number> {
  if (cryptoAmount <= 0) {
    throw new Error('Crypto amount must be greater than zero');
  }

  try {
    const rate = await getExchangeRate(cryptoCurrency, fiatCurrency);
    const fiatAmount = cryptoAmount * rate;
    
    // Round to 2 decimal places (standard for fiat)
    return Math.round(fiatAmount * 100) / 100;
  } catch (error) {
    throw new Error(
      `Failed to calculate fiat price: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Clear the rate cache (useful for testing)
 */
export function clearCache(): void {
  rateCache.clear();
}

/**
 * Get cache statistics (useful for monitoring)
 */
export function getCacheStats(): {
  size: number;
  entries: Array<{ key: string; age: number }>;
} {
  const entries = Array.from(rateCache.entries()).map(([key, cached]) => ({
    key,
    age: Date.now() - cached.timestamp,
  }));

  return {
    size: rateCache.size,
    entries,
  };
}