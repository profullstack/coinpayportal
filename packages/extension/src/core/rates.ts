/**
 * Exchange-rate cache in front of the portal's `GET /api/rates`.
 *
 * Two reasons this is not a bare fetch:
 *   - The endpoint is IP rate-limited. The Send tab re-quotes on every render,
 *     chain switch and currency change, and a 429 would blank the estimate for
 *     every wallet behind the same NAT.
 *   - Prices move slowly relative to typing. One quote per pair per TTL is
 *     plenty, and identical concurrent asks share a single in-flight request.
 *
 * Lives in the background service worker (the only context with host
 * permissions for coinpayportal.com); the popup asks for quotes over RPC.
 */

import type { CoinPayApi } from './api.js';
import type { FiatCurrency } from './fiat.js';

export interface RateQuote {
  coin: string;
  fiat: FiatCurrency;
  rate: number;
  /** Epoch ms the rate was fetched — the popup shows staleness, not just price. */
  fetchedAt: number;
}

const DEFAULT_TTL_MS = 60_000;

export class RateCache {
  #entries = new Map<string, RateQuote>();
  #inflight = new Map<string, Promise<RateQuote>>();

  constructor(
    private readonly api: Pick<CoinPayApi, 'getRate'>,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  static key(coin: string, fiat: FiatCurrency): string {
    return `${coin.toUpperCase()}:${fiat}`;
  }

  /** Cached quote if one is still fresh, else undefined. Never fetches. */
  peek(coin: string, fiat: FiatCurrency): RateQuote | undefined {
    const entry = this.#entries.get(RateCache.key(coin, fiat));
    if (!entry) return undefined;
    return this.now() - entry.fetchedAt < this.ttlMs ? entry : undefined;
  }

  /** Fresh-or-fetched quote. Rejects with the API error if the fetch fails. */
  async get(coin: string, fiat: FiatCurrency): Promise<RateQuote> {
    const key = RateCache.key(coin, fiat);
    const cached = this.peek(coin, fiat);
    if (cached) return cached;

    const pending = this.#inflight.get(key);
    if (pending) return pending;

    const request = this.api
      .getRate(coin, fiat)
      .then((rate) => {
        const quote: RateQuote = { coin: coin.toUpperCase(), fiat, rate, fetchedAt: this.now() };
        this.#entries.set(key, quote);
        return quote;
      })
      .finally(() => {
        // Drop the in-flight entry either way: a failure must not be cached as
        // a permanent "no rate", and the next ask should retry.
        this.#inflight.delete(key);
      });

    this.#inflight.set(key, request);
    return request;
  }

  clear(): void {
    this.#entries.clear();
  }
}
