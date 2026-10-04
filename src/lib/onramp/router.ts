/**
 * On-ramp quote router.
 *
 * Fans a single quote request out across every configured source, re-prices
 * each answer against mid-market spot, and ranks by the only number the user
 * actually experiences: how much crypto lands in their wallet.
 *
 * Why re-price at all: a ramp's disclosed fee is not its cost. MoonPay quotes
 * bank transfer at about 1%, but the margin lives in the rate it hands you, and
 * that margin has been reported as high as ~4.3%. Subtracting the disclosed fee
 * from the true all-in cost recovers the part nobody advertises. We do that
 * arithmetic here, once, so no provider adapter can flatter its own numbers.
 *
 * A source that is slow, broken or unconfigured must never fail the request —
 * it drops out of the ranking and is reported in `unavailable`, because a
 * silently missing provider looks identical to a provider that lost on price.
 */

import { getExchangeRate } from '@/lib/rates/tatum';
import {
  OnrampProvider,
  OnrampQuote,
  OnrampQuoteParams,
  OnrampQuoteResult,
  OnrampUnavailable,
  RawOnrampQuote,
  isOnrampSupported,
  pricingSymbol,
} from './types';

/**
 * How long a single source gets before it is dropped from the ranking.
 *
 * The fan-out is only as fast as its slowest member, so this is the ceiling on
 * user-visible quote latency, not a per-call nicety.
 */
export const PROVIDER_TIMEOUT_MS = 8_000;

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Attach the mid-market comparison to one raw quote.
 *
 * Exported for tests, and because the maths is the substance of this module —
 * it deserves to be exercised directly rather than only through a fan-out.
 */
export function priceAgainstSpot(raw: RawOnrampQuote, spotRate: number | null): OnrampQuote {
  // No spot, no honesty claim. Report the provider's own figures and leave the
  // derived fields null rather than inventing a comparison.
  if (!spotRate || !Number.isFinite(spotRate) || spotRate <= 0 || raw.fiatAmount <= 0) {
    return {
      ...raw,
      spotRate: null,
      spreadPct: null,
      allInCostPct: null,
      midMarketReceiveAmount: null,
    };
  }

  const midMarketReceiveAmount = raw.fiatAmount / spotRate;

  // Everything the purchase actually cost, against a zero-fee mid-market fill.
  const allInCostPct = (1 - raw.receiveAmount / midMarketReceiveAmount) * 100;

  // What the provider admitted to.
  const disclosedPct = (raw.fees.total / raw.fiatAmount) * 100;

  // The difference is the margin buried in the rate. This is the number that
  // makes a "1% fee" ramp and a "1.5% fee" ramp swap places.
  const spreadPct = allInCostPct - disclosedPct;

  return {
    ...raw,
    spotRate,
    spreadPct: round(spreadPct, 3),
    allInCostPct: round(allInCostPct, 3),
    midMarketReceiveAmount: round(midMarketReceiveAmount, 8),
  };
}

/**
 * Best first.
 *
 * Delivered amount decides it. Ties break on the smaller disclosed fee and then
 * the faster settlement, so a quote that matches on price but arrives sooner
 * wins. Never rank on fee percentage: that is the number being gamed.
 */
export function rankQuotes(quotes: OnrampQuote[]): OnrampQuote[] {
  return [...quotes].sort((a, b) => {
    if (b.receiveAmount !== a.receiveAmount) return b.receiveAmount - a.receiveAmount;
    if (a.fees.total !== b.fees.total) return a.fees.total - b.fees.total;
    const aEta = a.etaSeconds ?? Number.MAX_SAFE_INTEGER;
    const bEta = b.etaSeconds ?? Number.MAX_SAFE_INTEGER;
    return aEta - bEta;
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // AbortSignal.timeout surfaces as a TimeoutError; say so plainly rather
    // than showing the user "The operation was aborted".
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `No response within ${PROVIDER_TIMEOUT_MS / 1000}s`;
    }
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Mid-market spot, or null.
 *
 * Deliberately non-fatal: a pricing outage should degrade the spread column,
 * not take down quoting altogether. The user can still see delivered amounts
 * and still pick the best one — ranking never depends on spot.
 */
async function fetchSpot(cryptoAsset: string, fiatCurrency: string): Promise<number | null> {
  try {
    const rate = await getExchangeRate(pricingSymbol(cryptoAsset), fiatCurrency);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch (error) {
    console.warn('[Onramp Router] Spot rate unavailable:', describeError(error));
    return null;
  }
}

export interface RouterOptions {
  /** Override the provider set. Defaults to the registry in `providers.ts`. */
  providers?: OnrampProvider[];
  timeoutMs?: number;
}

/**
 * Quote an on-ramp purchase across every configured source.
 *
 * Resolves even when every source fails; callers distinguish "nothing
 * available" from "nothing configured" by reading `unavailable`.
 */
export async function getOnrampQuotes(
  params: OnrampQuoteParams,
  options: RouterOptions = {}
): Promise<OnrampQuoteResult> {
  if (!isOnrampSupported(params.cryptoAsset)) {
    throw new Error(`Unsupported asset: ${params.cryptoAsset}`);
  }
  if (!Number.isFinite(params.fiatAmount) || params.fiatAmount <= 0) {
    throw new Error('Fiat amount must be a positive number');
  }

  // Imported lazily so tests can inject providers without the registry
  // reaching for environment variables at module load.
  const providers = options.providers ?? (await import('./providers')).getOnrampProviders();
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  const unavailable: OnrampUnavailable[] = [];
  const active: OnrampProvider[] = [];

  for (const provider of providers) {
    if (provider.isConfigured()) {
      active.push(provider);
    } else {
      unavailable.push({
        source: provider.id,
        reason: 'Not configured — no API credentials set',
      });
    }
  }

  // Spot is fetched alongside the providers, not before them: it is an
  // enrichment, and making it a prerequisite would put a third-party pricing
  // call on the critical path of every quote.
  const [spotRate, ...settled] = await Promise.all([
    fetchSpot(params.cryptoAsset, params.fiatCurrency),
    ...active.map(async (provider) => {
      try {
        const quotes = await provider.quote(params, AbortSignal.timeout(timeoutMs));
        return { provider, quotes };
      } catch (error) {
        return { provider, error };
      }
    }),
  ]);

  const raw: RawOnrampQuote[] = [];

  for (const outcome of settled) {
    if ('error' in outcome && outcome.error !== undefined) {
      console.error(`[Onramp Router] ${outcome.provider.id} failed:`, outcome.error);
      unavailable.push({ source: outcome.provider.id, reason: describeError(outcome.error) });
      continue;
    }

    const quotes = 'quotes' in outcome ? outcome.quotes : [];
    if (!quotes || quotes.length === 0) {
      unavailable.push({
        source: outcome.provider.id,
        reason: 'No quote for this asset, amount or country',
      });
      continue;
    }

    // A quote that cannot deliver anything is not a quote.
    for (const quote of quotes) {
      if (Number.isFinite(quote.receiveAmount) && quote.receiveAmount > 0) {
        raw.push(quote);
      }
    }
  }

  const ranked = rankQuotes(raw.map((quote) => priceAgainstSpot(quote, spotRate)));

  return {
    quotes: ranked,
    best: ranked[0] ?? null,
    spotRate,
    unavailable,
  };
}
