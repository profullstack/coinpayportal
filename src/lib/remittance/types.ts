/**
 * Remittance types — crypto in, local fiat out.
 *
 * The sender funds with stablecoin they already hold and the recipient is paid
 * in local currency through a partner's licensed payout rail. We never take the
 * sender's dollars, so the US money-transmission leg does not exist for us;
 * what remains is a payout integration that runs under the partner's licence.
 *
 * The ranking idea is the one from `src/lib/onramp`, moved one corridor over.
 * A remittance provider's disclosed fee is not its cost: on this market the
 * margin hides in the FX rate, and it is routinely larger than the visible fee.
 * Xoom on a $200 send to the Philippines charges $4.99 and takes another 4.49%
 * in the rate — two thirds of the cost is the part nobody quotes.
 *
 * So every quote here carries `receiveAmount` in local currency as its primary
 * field, and the router re-prices it against the mid-market FX rate to recover
 * the margin. That arithmetic lives in the router alone, so no provider adapter
 * can flatter its own numbers.
 */

/** Corridors we serve. Sending side is always the US. */
export type Corridor = 'US-MX' | 'US-PH' | 'US-NG' | 'US-VN';

/** How the recipient actually gets the money. */
export type PayoutMethod = 'bank' | 'ewallet' | 'cash_pickup' | 'debit_card';

export interface CorridorSpec {
  corridor: Corridor;
  destinationCountry: string;
  payoutCurrency: string;
  /** Payout rails available in this corridor. */
  methods: PayoutMethod[];
  /**
   * Named networks per method — the recipient picks one of these, and in the
   * Philippines the e-wallet choice matters more than the bank rail does.
   */
  networks: Partial<Record<PayoutMethod, string[]>>;
  /**
   * Set when no single "mid-market" rate is meaningful for this currency.
   *
   * The naira trades at a persistent premium on the parallel market over the
   * official NFEM rate — a few percent apart at the time of writing. Our FX
   * reference quotes the official one, so a partner pricing off the street rate
   * looks like it has a *negative* margin. That is an artefact of comparing two
   * different markets, not a bargain, and the router says so on the quote
   * rather than publishing a confident wrong number.
   */
  fxReferenceContested?: boolean;
}

export const CORRIDORS: Record<Corridor, CorridorSpec> = {
  'US-MX': {
    corridor: 'US-MX',
    destinationCountry: 'MX',
    payoutCurrency: 'MXN',
    methods: ['bank', 'cash_pickup', 'debit_card'],
    networks: {
      // SPEI settles 24/7 and is the reason this corridor is cheap.
      bank: ['spei'],
      cash_pickup: ['oxxo', 'elektra', 'banorte'],
      debit_card: ['dimo'],
    },
  },
  'US-PH': {
    corridor: 'US-PH',
    destinationCountry: 'PH',
    payoutCurrency: 'PHP',
    methods: ['bank', 'ewallet', 'cash_pickup'],
    networks: {
      bank: ['instapay', 'pesonet'],
      // E-wallet first: for Philippine families GCash matters more than the
      // bank rails do.
      ewallet: ['gcash', 'maya'],
      cash_pickup: ['cebuana', 'mlhuillier', 'palawan'],
    },
  },
  'US-NG': {
    corridor: 'US-NG',
    destinationCountry: 'NG',
    payoutCurrency: 'NGN',
    methods: ['bank', 'ewallet'],
    networks: {
      // NIP (NIBSS Instant Payment) reaches every Nigerian bank, and the
      // fintech wallets are built on top of it rather than beside it.
      bank: ['nip'],
      ewallet: ['opay', 'palmpay', 'kuda'],
    },
    fxReferenceContested: true,
  },
  'US-VN': {
    corridor: 'US-VN',
    destinationCountry: 'VN',
    payoutCurrency: 'VND',
    methods: ['bank', 'ewallet'],
    networks: {
      bank: ['napas247', 'vietqr'],
      ewallet: ['momo', 'zalopay', 'vnpay'],
    },
  },
};

export const SUPPORTED_CORRIDORS = Object.keys(CORRIDORS) as Corridor[];

/** Stablecoins a sender may fund with. */
export const SUPPORTED_SEND_ASSETS = [
  'USDC',
  'USDC_ETH',
  'USDC_POL',
  'USDC_SOL',
  'USDT',
  'USDT_ETH',
  'USDT_POL',
  'USDT_SOL',
] as const;

export type SendAsset = (typeof SUPPORTED_SEND_ASSETS)[number];

export function isSupportedSendAsset(asset: string): asset is SendAsset {
  return (SUPPORTED_SEND_ASSETS as readonly string[]).includes(asset);
}

/** Find the corridor for a destination country, or null. */
export function corridorFor(destinationCountry: string): CorridorSpec | null {
  const code = destinationCountry.toUpperCase();
  return Object.values(CORRIDORS).find((spec) => spec.destinationCountry === code) ?? null;
}

/** The ticker an asset is priced with — `USDC_POL` prices as `USDC`. */
export function pricingSymbol(asset: string): string {
  return asset.split('_')[0].toUpperCase();
}

export interface RemittanceQuoteParams {
  /** Stablecoin the sender is funding with. */
  sendAsset: string;
  /** Amount of that asset, in its own units. */
  sendAmount: number;
  /** ISO 3166-1 alpha-2 of the destination, e.g. "MX". */
  destinationCountry: string;
  payoutMethod?: PayoutMethod;
  /** A specific rail, e.g. "gcash" or "spei". */
  payoutNetwork?: string;
}

/** Fees in USD — the common denominator across corridors. */
export interface RemittanceFees {
  /** The partner's disclosed cut. */
  provider: number;
  /** Chain cost to move the stablecoin to them. */
  network: number;
  /** Local rail cost, where the partner itemises it. */
  payout: number;
  total: number;
}

export interface RawRemittanceQuote {
  provider: string;
  providerLabel: string;
  source: string;
  corridor: Corridor;
  sendAsset: string;
  sendAmount: number;
  payoutCurrency: string;
  payoutMethod: PayoutMethod;
  payoutNetwork: string | null;
  /** Local currency the recipient actually receives. The number that matters. */
  receiveAmount: number;
  fees: RemittanceFees;
  /** The partner's own FX rate, local currency per 1 USD. */
  quotedFxRate: number | null;
  etaSeconds: number | null;
  minSendAmountUsd: number | null;
  maxSendAmountUsd: number | null;
  warnings: string[];
}

/** A raw quote re-priced against mid-market FX. */
export interface RemittanceQuote extends RawRemittanceQuote {
  /** USD value of what the sender is sending, at crypto spot. */
  sendValueUsd: number | null;
  /** Mid-market FX, local currency per 1 USD. */
  midMarketFxRate: number | null;
  /**
   * The margin taken in the rate, as a percentage of principal — the part of
   * the cost that is not in the disclosed fee. Null when FX is unavailable;
   * never guessed.
   */
  fxMarginPct: number | null;
  /** Fees and FX margin together, against a mid-market send. */
  allInCostPct: number | null;
  /** What a zero-cost transfer would have delivered. */
  midMarketReceiveAmount: number | null;
}

export interface RemittanceUnavailable {
  source: string;
  reason: string;
}

export interface RemittanceQuoteResult {
  /** Ranked best-first by `receiveAmount`. */
  quotes: RemittanceQuote[];
  best: RemittanceQuote | null;
  corridor: Corridor;
  payoutCurrency: string;
  sendValueUsd: number | null;
  midMarketFxRate: number | null;
  unavailable: RemittanceUnavailable[];
}

/**
 * A remittance payout source.
 *
 * Same contract shape as the swap and on-ramp providers, for the same reason:
 * adding a corridor partner must never mean touching the router.
 */
export interface RemittanceProvider {
  readonly id: string;
  readonly label: string;
  /** Corridors this partner can actually pay into. */
  readonly corridors: Corridor[];
  isConfigured(): boolean;
  quote(params: RemittanceQuoteParams, signal?: AbortSignal): Promise<RawRemittanceQuote[]>;
}

/** True when this partner serves the corridor at all. */
export function servesCorridor(provider: RemittanceProvider, corridor: Corridor): boolean {
  return provider.corridors.includes(corridor);
}
