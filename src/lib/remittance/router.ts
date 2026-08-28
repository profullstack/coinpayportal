/**
 * Remittance quote router.
 *
 * Asks every partner that serves the corridor what the recipient would actually
 * receive, re-prices each answer against mid-market FX, and ranks on the local
 * currency delivered.
 *
 * Why re-price: on this market the disclosed fee is the smaller half of the
 * cost. Xoom on a $200 send to the Philippines charges $4.99 and takes another
 * 4.49% in the rate. Subtracting the disclosed fee from the true all-in cost
 * recovers the FX margin, which is the number that decides whether a transfer
 * was actually cheap. It is computed here, once, for every source uniformly.
 *
 * A partner that is slow, broken or unconfigured drops out of the ranking and
 * is reported in `unavailable` rather than failing the request — a silently
 * missing partner looks identical to one that lost on price.
 */

import { getExchangeRate } from '@/lib/rates/tatum';
import { getUsdFxRate } from '@/lib/rates/fx';
import {
  Corridor,
  RemittanceProvider,
  RemittanceQuote,
  RemittanceQuoteParams,
  RemittanceQuoteResult,
  RemittanceUnavailable,
  RawRemittanceQuote,
  corridorFor,
  isSupportedSendAsset,
  pricingSymbol,
  servesCorridor,
} from './types';

/** Ceiling on user-visible quote latency: the fan-out waits for its slowest member. */
export const PROVIDER_TIMEOUT_MS = 8_000;

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Attach the mid-market comparison to one raw quote.
 *
 * Exported because this arithmetic is the substance of the module and deserves
 * to be exercised directly, not only through a fan-out.
 *
 * @param sendValueUsd  USD value of the stablecoin being sent, at spot.
 * @param midMarketFxRate  Local currency per 1 USD.
 */
export function priceAgainstMidMarket(
  raw: RawRemittanceQuote,
  sendValueUsd: number | null,
  midMarketFxRate: number | null
): RemittanceQuote {
  const usable =
    sendValueUsd !== null &&
    midMarketFxRate !== null &&
    Number.isFinite(sendValueUsd) &&
    Number.isFinite(midMarketFxRate) &&
    sendValueUsd > 0 &&
    midMarketFxRate > 0;

  // Without both legs there is no honest comparison to make. Report the
  // partner's own figures and leave the derived fields null.
  if (!usable) {
    return {
      ...raw,
      sendValueUsd: sendValueUsd ?? null,
      midMarketFxRate: midMarketFxRate ?? null,
      fxMarginPct: null,
      allInCostPct: null,
      midMarketReceiveAmount: null,
    };
  }

  const midMarketReceiveAmount = sendValueUsd! * midMarketFxRate!;

  // Everything the transfer actually cost, against a zero-fee mid-market send.
  const allInCostPct = (1 - raw.receiveAmount / midMarketReceiveAmount) * 100;

  // What the partner admitted to, as a share of principal.
  const disclosedPct = (raw.fees.total / sendValueUsd!) * 100;

  // The remainder is the margin buried in the rate.
  const fxMarginPct = allInCostPct - disclosedPct;

  return {
    ...raw,
    sendValueUsd: round(sendValueUsd!, 2),
    midMarketFxRate,
    fxMarginPct: round(fxMarginPct, 3),
    allInCostPct: round(allInCostPct, 3),
    midMarketReceiveAmount: round(midMarketReceiveAmount, 2),
  };
}

/**
 * Best first.
 *
 * Local currency delivered decides it. Ties break on the smaller disclosed fee
 * and then the faster payout. Never rank on fee percentage: on this market that
 * is precisely the number being gamed.
 */
export function rankQuotes(quotes: RemittanceQuote[]): RemittanceQuote[] {
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
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `No response within ${PROVIDER_TIMEOUT_MS / 1000}s`;
    }
    return error.message;
  }
  return 'Unknown error';
}

/**
 * USD value of the stablecoin being sent.
 *
 * Not assumed to be 1:1. A depegged or simply mispriced stablecoin would
 * silently distort every cost figure downstream, and the whole point of this
 * module is that the cost figures are trustworthy.
 */
async function fetchSendValueUsd(asset: string, amount: number): Promise<number | null> {
  try {
    const rate = await getExchangeRate(pricingSymbol(asset), 'USD');
    return Number.isFinite(rate) && rate > 0 ? amount * rate : null;
  } catch (error) {
    console.warn('[Remittance Router] Send-asset spot unavailable:', describeError(error));
    return null;
  }
}

/** Mid-market FX, local per USD. Non-fatal: ranking never depends on it. */
async function fetchMidMarketFx(payoutCurrency: string): Promise<number | null> {
  try {
    const rate = await getUsdFxRate(payoutCurrency);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch (error) {
    console.warn('[Remittance Router] Mid-market FX unavailable:', describeError(error));
    return null;
  }
}

export interface RouterOptions {
  providers?: RemittanceProvider[];
  timeoutMs?: number;
}

/**
 * Quote a remittance across every partner serving the corridor.
 *
 * Resolves even when every partner fails; callers tell "nothing available"
 * from "nothing configured" by reading `unavailable`.
 */
export async function getRemittanceQuotes(
  params: RemittanceQuoteParams,
  options: RouterOptions = {}
): Promise<RemittanceQuoteResult> {
  if (!isSupportedSendAsset(params.sendAsset)) {
    throw new Error(`Unsupported send asset: ${params.sendAsset}`);
  }
  if (!Number.isFinite(params.sendAmount) || params.sendAmount <= 0) {
    throw new Error('Send amount must be a positive number');
  }

  const spec = corridorFor(params.destinationCountry);
  if (!spec) {
    throw new Error(`Unsupported destination: ${params.destinationCountry}`);
  }
  if (params.payoutMethod && !spec.methods.includes(params.payoutMethod)) {
    throw new Error(
      `${spec.corridor} does not support payout method: ${params.payoutMethod}`
    );
  }

  const corridor: Corridor = spec.corridor;

  // Imported lazily so tests can inject partners without the registry reading
  // environment variables at module load.
  const providers = options.providers ?? (await import('./providers')).getRemittanceProviders();
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  const unavailable: RemittanceUnavailable[] = [];
  const active: RemittanceProvider[] = [];

  for (const provider of providers) {
    if (!servesCorridor(provider, corridor)) {
      // Not a failure — this partner simply does not serve this corridor, and
      // saying so is more useful than omitting it.
      unavailable.push({ source: provider.id, reason: `Does not serve ${corridor}` });
    } else if (!provider.isConfigured()) {
      unavailable.push({ source: provider.id, reason: 'Not configured — no API credentials set' });
    } else {
      active.push(provider);
    }
  }

  // Pricing runs alongside the partners rather than before them: it is an
  // enrichment, and putting it on the critical path would make every quote
  // wait on two third-party rate lookups.
  const [sendValueUsd, midMarketFxRate, ...settled] = await Promise.all([
    fetchSendValueUsd(params.sendAsset, params.sendAmount),
    fetchMidMarketFx(spec.payoutCurrency),
    ...active.map(async (provider) => {
      try {
        const quotes = await provider.quote(params, AbortSignal.timeout(timeoutMs));
        return { provider, quotes };
      } catch (error) {
        return { provider, error };
      }
    }),
  ]);

  const raw: RawRemittanceQuote[] = [];

  for (const outcome of settled) {
    if ('error' in outcome && outcome.error !== undefined) {
      console.error(`[Remittance Router] ${outcome.provider.id} failed:`, outcome.error);
      unavailable.push({ source: outcome.provider.id, reason: describeError(outcome.error) });
      continue;
    }

    const quotes = 'quotes' in outcome ? outcome.quotes : [];
    if (!quotes || quotes.length === 0) {
      unavailable.push({
        source: outcome.provider.id,
        reason: 'No quote for this amount or payout method',
      });
      continue;
    }

    for (const quote of quotes) {
      // A payout of nothing is not a quote.
      if (Number.isFinite(quote.receiveAmount) && quote.receiveAmount > 0) {
        raw.push(quote);
      }
    }
  }

  const priced = raw.map((quote) => priceAgainstMidMarket(quote, sendValueUsd, midMarketFxRate));

  // Where the reference rate is contested, the derived margin compares two
  // different markets. The figure is still worth showing, but never without
  // saying what it is measured against.
  if (spec.fxReferenceContested && midMarketFxRate !== null) {
    for (const quote of priced) {
      if (quote.fxMarginPct !== null) {
        quote.warnings = [
          ...quote.warnings,
          `${spec.payoutCurrency} has no single mid-market rate — this margin is measured against the official rate and the street rate differs`,
        ];
      }
    }
  }

  const ranked = rankQuotes(priced);

  return {
    quotes: ranked,
    best: ranked[0] ?? null,
    corridor,
    payoutCurrency: spec.payoutCurrency,
    sendValueUsd: sendValueUsd === null ? null : round(sendValueUsd, 2),
    midMarketFxRate,
    unavailable,
  };
}
