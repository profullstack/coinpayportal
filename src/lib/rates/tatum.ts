/**
 * Tatum API Exchange Rate Service
 * Provides real-time cryptocurrency exchange rates
 */

const TATUM_API_BASE = 'https://api.tatum.io';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

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
 * Fetch exchange rate from Tatum API
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

    // Fetch from API
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