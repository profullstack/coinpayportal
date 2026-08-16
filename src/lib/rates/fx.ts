/**
 * Fiat FX rates (USD → everything else).
 *
 * Crypto prices come from Kraken, which only quotes our pairs in USD. Without
 * a fiat leg, every non-USD display currency in `SUPPORTED_FIAT_CURRENCIES`
 * fails outright — so coin/EUR is priced as coin/USD × USD/EUR.
 *
 * Sources are keyless on purpose (no new secret to provision):
 *   Primary  — Frankfurter, ECB reference rates, published each weekday.
 *   Fallback — open.er-api.com, same figures to ~4 decimals.
 *
 * FX moves slowly, so rates are cached for an hour and a stale set is preferred
 * over an outright failure for up to a day: showing a price that is a few hours
 * old beats showing none at all.
 */

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';
const ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

const FX_CACHE_TTL = 60 * 60 * 1000; // 1 hour
/** How long a cached set may be served after a refresh failure. */
const FX_STALE_GRACE = 24 * 60 * 60 * 1000;

interface FxSnapshot {
  rates: Record<string, number>;
  timestamp: number;
}

let cache: FxSnapshot | null = null;

/** Test seam — drops the cached snapshot. */
export function clearFxCache(): void {
  cache = null;
}

async function fetchFromFrankfurter(): Promise<Record<string, number>> {
  const response = await fetch(FRANKFURTER_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Frankfurter API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const rates = data?.rates;
  if (!rates || typeof rates !== 'object') {
    throw new Error('Frankfurter API returned no rates');
  }
  return rates as Record<string, number>;
}

async function fetchFromErApi(): Promise<Record<string, number>> {
  const response = await fetch(ER_API_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`open.er-api.com error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const rates = data?.rates;
  if (data?.result === 'error' || !rates || typeof rates !== 'object') {
    throw new Error('open.er-api.com returned no rates');
  }
  return rates as Record<string, number>;
}

async function refresh(): Promise<FxSnapshot> {
  let rates: Record<string, number>;
  try {
    rates = await fetchFromFrankfurter();
  } catch (primaryError) {
    console.warn(
      '[FX] Frankfurter failed, falling back to open.er-api.com:',
      primaryError instanceof Error ? primaryError.message : primaryError
    );
    rates = await fetchFromErApi();
  }
  cache = { rates, timestamp: Date.now() };
  return cache;
}

/**
 * How many units of `fiat` one US dollar buys. USD is 1 by definition and
 * never hits the network.
 *
 * @throws if no provider answers and there is no usable cached snapshot, or if
 *         the providers do not quote this currency — never returns a guess.
 */
export async function getUsdFxRate(fiat: string): Promise<number> {
  const code = fiat.toUpperCase();
  if (code === 'USD') return 1;

  let snapshot = cache;
  if (!snapshot || Date.now() - snapshot.timestamp >= FX_CACHE_TTL) {
    try {
      snapshot = await refresh();
    } catch (error) {
      // Serve a stale snapshot rather than nothing — but only briefly, and
      // never in place of a rate we never had.
      if (!snapshot || Date.now() - snapshot.timestamp >= FX_STALE_GRACE) {
        throw new Error(
          `Failed to fetch USD/${code} FX rate: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
      console.warn(`[FX] Refresh failed, serving cached rates for USD/${code}`);
    }
  }

  const rate = snapshot.rates[code];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No USD/${code} FX rate available`);
  }
  return rate;
}

/**
 * Convert a USD amount into `fiat`.
 *
 * Several call sites compute a cost in USD (network fees, platform fees) and
 * then need to add it to an amount denominated in the invoice currency. Adding
 * the two directly mixes units, so route every such addition through here.
 *
 * @throws if the rate is unavailable — never silently treats the amount as USD.
 */
export async function convertUsdTo(amountUsd: number, fiat: string): Promise<number> {
  if (!Number.isFinite(amountUsd)) {
    throw new Error('convertUsdTo requires a finite USD amount');
  }
  if (amountUsd === 0) return 0;
  const rate = await getUsdFxRate(fiat);
  return amountUsd * rate;
}
