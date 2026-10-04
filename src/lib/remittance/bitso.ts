/**
 * Bitso — US→MX payout partner.
 *
 * The dominant crypto rail on this corridor: Bitso processed more than
 * USD 6.5bn of US–Mexico remittances in 2024, and settles MXN over SPEI 24/7.
 * On this corridor we are joining a proven rail rather than pioneering one.
 *
 * Docs: https://docs.bitso.com  |  https://bitso.com/business
 *
 * Quoting here uses Bitso's **public** ticker (`/v3/ticker`), which needs no
 * credentials. That is deliberate: it means the Mexico corridor can be quoted
 * honestly today, against a real order book, before anyone signs a partner
 * agreement. The rate a sender gets for selling stablecoin into pesos is the
 * book's bid, so that is what the payout is derived from.
 *
 * Executing a payout is a different matter and does need credentials — see
 * {@link BitsoProvider.canExecutePayouts}. The fee assumptions below are
 * placeholders until a commercial rate exists; they are read from the
 * environment so a real contract does not require a code change.
 */

import {
  Corridor,
  RawRemittanceQuote,
  RemittanceProvider,
  RemittanceQuoteParams,
  pricingSymbol,
} from './types';

const BITSO_API_URL = 'https://api.bitso.com';

/**
 * Order books Bitso quotes for pesos, by stablecoin.
 *
 * Verified against `/v3/available_books`: Bitso lists `usdt_mxn` but **not**
 * `usdc_mxn` — asking for that book returns HTTP 400 "Unknown OrderBook". USDC
 * is therefore priced off the dollar book, which tracks it closely and is the
 * deepest book on the venue by volume.
 */
const BOOK_BY_ASSET: Record<string, string> = {
  USDT: 'usdt_mxn',
  USDC: 'usd_mxn',
};

/** Fallback when the asset has no book of its own. */
const FALLBACK_BOOK = 'usd_mxn';

/**
 * Commercial assumptions, overridable from the environment.
 *
 * Defaults are deliberately conservative rather than flattering: a quote that
 * turns out worse than promised is a broken product, whereas one that turns out
 * better is a pleasant surprise.
 */
function feeAssumptions(): { pct: number; fixedUsd: number; networkUsd: number } {
  const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  return {
    pct: num(process.env.BITSO_FEE_PCT, 0.5),
    fixedUsd: num(process.env.BITSO_FEE_FIXED_USD, 0),
    // SPEI is close to free; the cost is moving the stablecoin to them.
    networkUsd: num(process.env.BITSO_NETWORK_FEE_USD, 0.5),
  };
}

interface BitsoTicker {
  success?: boolean;
  error?: { code?: number; message?: string };
  payload?: {
    book?: string;
    bid?: string;
    ask?: string;
    last?: string;
  };
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Build a quote from a live book price.
 *
 * Exported for tests: this is where the corridor's economics are decided, and
 * it should be checkable without reaching the network.
 */
export function quoteFromBid(
  bidMxnPerUnit: number,
  book: string,
  params: RemittanceQuoteParams,
  fees = feeAssumptions(),
  /** True only when the asset's own book failed and we used another one. */
  fellBack = false
): RawRemittanceQuote | null {
  if (!Number.isFinite(bidMxnPerUnit) || bidMxnPerUnit <= 0) return null;

  // Stablecoin units are ~1 USD, and the router re-checks that against real
  // spot; here it is only used to size the percentage fee.
  const approxUsd = params.sendAmount;
  const providerFee = (approxUsd * fees.pct) / 100 + fees.fixedUsd;
  const totalFeeUsd = providerFee + fees.networkUsd;

  const netUnits = params.sendAmount - totalFeeUsd;
  if (netUnits <= 0) return null;

  const warnings: string[] = [];
  if (fellBack) {
    warnings.push(`Priced from the ${book} book; the ${params.sendAsset} book was unavailable`);
  }

  return {
    provider: 'bitso',
    providerLabel: 'Bitso',
    source: 'bitso',
    corridor: 'US-MX' as Corridor,
    sendAsset: params.sendAsset,
    sendAmount: params.sendAmount,
    payoutCurrency: 'MXN',
    payoutMethod: params.payoutMethod ?? 'bank',
    payoutNetwork: params.payoutNetwork ?? 'spei',
    receiveAmount: netUnits * bidMxnPerUnit,
    fees: {
      provider: providerFee,
      network: fees.networkUsd,
      payout: 0,
      total: totalFeeUsd,
    },
    quotedFxRate: bidMxnPerUnit,
    // SPEI clears in seconds, around the clock. That is the corridor's
    // structural advantage over an ACH-funded competitor.
    etaSeconds: 60,
    minSendAmountUsd: 10,
    maxSendAmountUsd: null,
    warnings,
  };
}

export class BitsoProvider implements RemittanceProvider {
  readonly id = 'bitso';
  readonly label = 'Bitso';
  readonly corridors: Corridor[] = ['US-MX'];

  /**
   * Quoting needs no credentials, so this partner is always available to
   * quote. Whether we could *settle* through it is a separate question.
   */
  isConfigured(): boolean {
    return true;
  }

  /** True once a partner agreement's credentials are present. */
  canExecutePayouts(): boolean {
    return Boolean(process.env.BITSO_API_KEY && process.env.BITSO_API_SECRET);
  }

  private async ticker(book: string, signal?: AbortSignal): Promise<number | null> {
    const response = await fetch(`${BITSO_API_URL}/v3/ticker/?book=${book}`, { signal });

    // An unlisted book answers 400 with an error body rather than 404. That is
    // "this pair does not trade here", not an outage, so it returns null and
    // lets the caller try the next book instead of failing the whole quote.
    if (response.status === 400) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Bitso API error ${response.status}`);
    }

    const body = (await response.json()) as BitsoTicker;
    if (body?.success === false || body?.error) return null;

    // The sender is selling stablecoin for pesos, so the bid is the honest
    // side of the book. Falling back to `last` would quote a trade that
    // nobody is currently willing to make.
    return toFiniteNumber(body?.payload?.bid);
  }

  async quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]> {
    const preferred = BOOK_BY_ASSET[pricingSymbol(params.sendAsset)] ?? FALLBACK_BOOK;
    // Deduped: for USDC the preferred book already is the dollar book, and
    // asking Bitso for it twice would be pointless.
    const books = [...new Set([preferred, FALLBACK_BOOK])];

    for (const book of books) {
      let bid: number | null = null;
      try {
        bid = await this.ticker(book, signal);
      } catch (error) {
        // Only the last book's failure is worth surfacing; an unlisted
        // stablecoin book is expected, not an outage.
        if (book === books[books.length - 1]) throw error;
        continue;
      }

      if (bid !== null) {
        const quote = quoteFromBid(bid, book, params, feeAssumptions(), book !== preferred);
        return quote ? [quote] : [];
      }
    }

    return [];
  }
}
