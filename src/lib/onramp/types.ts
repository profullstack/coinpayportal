/**
 * Fiat on-ramp types.
 *
 * The organising idea of this module is that a quote is judged by the amount of
 * crypto that actually lands in the wallet, not by the fee percentage a provider
 * chooses to disclose. Ramps make most of their margin on the spread they build
 * into the quoted rate, which no disclosed "1% fee" ever mentions. So every
 * quote here carries `receiveAmount` as its primary field, and the router
 * re-prices it against mid-market spot to recover the spread the provider did
 * not tell us about.
 *
 * Providers return {@link RawOnrampQuote}. The router enriches those into
 * {@link OnrampQuote}. Spread and all-in cost are computed in exactly one place
 * (the router) so no provider can flatter its own numbers.
 */

/** Payment rails, normalised across providers. */
export type OnrampPaymentMethod =
  | 'bank_transfer'
  | 'card'
  | 'apple_pay'
  | 'google_pay'
  | 'ewallet'
  | 'pix'
  | 'other';

export interface OnrampQuoteParams {
  /** ISO 4217, e.g. "USD". */
  fiatCurrency: string;
  /** Amount of fiat the user is spending. */
  fiatAmount: number;
  /** Our internal asset symbol, e.g. "BTC" or "USDC_POL". */
  cryptoAsset: string;
  /** Restrict to one rail. Omit to quote every rail the provider offers. */
  paymentMethod?: OnrampPaymentMethod;
  /** ISO 3166-1 alpha-2. Providers gate availability and fees on this. */
  country?: string;
}

/** Fee breakdown in units of the fiat currency being spent. */
export interface OnrampFees {
  /** The ramp's own disclosed cut. */
  provider: number;
  /** Blockchain fee passed through to the user. */
  network: number;
  /** Card/ACH processing cost, where the provider itemises it separately. */
  payment: number;
  /** Sum of the above — what the provider would call "the fee". */
  total: number;
}

/**
 * What a provider hands back, before we check its arithmetic against spot.
 */
export interface RawOnrampQuote {
  /** The ramp actually filling the order, e.g. "moonpay". */
  provider: string;
  /** Human-facing name, e.g. "MoonPay". */
  providerLabel: string;
  /** The integration that surfaced this quote — "onramper", "transak", "stub". */
  source: string;
  paymentMethod: OnrampPaymentMethod;
  fiatCurrency: string;
  fiatAmount: number;
  cryptoAsset: string;
  /** Crypto units that land in the wallet. The number that matters. */
  receiveAmount: number;
  fees: OnrampFees;
  /** Provider's quoted price, in fiat per 1 unit of crypto. */
  quotedRate: number | null;
  /** Estimated settlement time, seconds. Null when the provider won't say. */
  etaSeconds: number | null;
  minFiatAmount: number | null;
  maxFiatAmount: number | null;
  /** Anything the user should see before committing. */
  warnings: string[];
}

/**
 * A raw quote re-priced against mid-market. The added fields are the honest ones.
 */
export interface OnrampQuote extends RawOnrampQuote {
  /** Mid-market rate at quote time, fiat per 1 crypto. Null if unavailable. */
  spotRate: number | null;
  /**
   * The margin built into the quoted rate, as a percentage of principal.
   * Null when spot is unavailable — never guessed.
   */
  spreadPct: number | null;
  /**
   * Total cost against mid-market: disclosed fees *and* spread, as a
   * percentage of the fiat spent. This is the only number worth ranking on
   * once you have it, and the one no ramp advertises.
   */
  allInCostPct: number | null;
  /** What the user would receive at mid-market with zero fees. */
  midMarketReceiveAmount: number | null;
}

/** A provider that could not be quoted, and why. Surfaced, never swallowed. */
export interface OnrampUnavailable {
  source: string;
  reason: string;
}

export interface OnrampQuoteResult {
  /** Ranked best-first by `receiveAmount`. */
  quotes: OnrampQuote[];
  /** Convenience handle on `quotes[0]`. */
  best: OnrampQuote | null;
  /** Mid-market rate used for the spread maths, or null. */
  spotRate: number | null;
  /** Sources that failed or were not configured. */
  unavailable: OnrampUnavailable[];
}

export interface OnrampSessionParams {
  fiatCurrency: string;
  fiatAmount: number;
  cryptoAsset: string;
  /** Destination address. The crypto is delivered straight here. */
  walletAddress: string;
  /** Pin the order to one ramp, normally the winner of a quote. */
  provider?: string;
  paymentMethod?: OnrampPaymentMethod;
  country?: string;
  /** Where the provider returns the user once the order completes. */
  redirectUrl?: string;
  /** Our own correlation id, echoed back on webhooks. */
  externalId?: string;
}

/**
 * A hand-off to the provider's hosted flow.
 *
 * The user completes KYC and payment on the provider's side, which is the
 * point: they are merchant of record, so the chargeback lands on them and not
 * on us.
 */
export interface OnrampSession {
  source: string;
  provider: string;
  /** URL to send the user to. */
  url: string;
  /** Provider's id for the order, where one exists before the user starts. */
  sessionId: string | null;
  expiresAt: string | null;
}

export interface OnrampAssets {
  source: string;
  fiat: string[];
  crypto: string[];
  paymentMethods: OnrampPaymentMethod[];
}

/**
 * The contract every on-ramp integration implements.
 *
 * Deliberately the same shape as the swap providers in `src/lib/swap`: quoting
 * is a fan-out, and adding a source must never mean touching the router.
 */
export interface OnrampProvider {
  readonly id: string;
  readonly label: string;
  /** False when credentials are absent. The router skips it, and says so. */
  isConfigured(): boolean;
  /** An aggregator returns several quotes here — one per ramp behind it. */
  quote(params: OnrampQuoteParams, signal?: AbortSignal): Promise<RawOnrampQuote[]>;
  createSession(params: OnrampSessionParams, signal?: AbortSignal): Promise<OnrampSession>;
  listAssets(signal?: AbortSignal): Promise<OnrampAssets>;
}

/**
 * Our asset symbols mapped to the ids ramps use.
 *
 * Mirrors CN_COIN_MAP in `src/lib/swap/changenow.ts`. Ramps key on
 * (asset, network) because the same ticker settles on several chains, and
 * getting it wrong sends funds to an address the user does not control.
 */
export const ONRAMP_ASSET_MAP: Record<string, { asset: string; network: string }> = {
  BTC: { asset: 'btc', network: 'bitcoin' },
  BCH: { asset: 'bch', network: 'bitcoincash' },
  ETH: { asset: 'eth', network: 'ethereum' },
  POL: { asset: 'pol', network: 'polygon' },
  SOL: { asset: 'sol', network: 'solana' },
  BNB: { asset: 'bnb', network: 'bsc' },
  DOGE: { asset: 'doge', network: 'dogecoin' },
  XRP: { asset: 'xrp', network: 'ripple' },
  ADA: { asset: 'ada', network: 'cardano' },
  USDT: { asset: 'usdt', network: 'ethereum' },
  USDT_ETH: { asset: 'usdt', network: 'ethereum' },
  USDT_POL: { asset: 'usdt', network: 'polygon' },
  USDT_SOL: { asset: 'usdt', network: 'solana' },
  USDC: { asset: 'usdc', network: 'ethereum' },
  USDC_ETH: { asset: 'usdc', network: 'ethereum' },
  USDC_POL: { asset: 'usdc', network: 'polygon' },
  USDC_SOL: { asset: 'usdc', network: 'solana' },
  // Base is where x402 settles, so it is the one chain an agent wallet must be
  // fundable on. The rest of the codebase has known USDC_BASE since the x402
  // work; this module was the only place still missing it, which meant the
  // chain our own machine payments run on could not be bought into at all.
  USDC_BASE: { asset: 'usdc', network: 'base' },
};

/** Assets we can deliver an on-ramp purchase into. */
export const ONRAMP_SUPPORTED_ASSETS = Object.keys(ONRAMP_ASSET_MAP);

/**
 * The crypto ticker to price an asset with. `USDC_POL` is priced as `USDC`;
 * the chain does not change what a dollar of it is worth.
 */
export function pricingSymbol(cryptoAsset: string): string {
  return cryptoAsset.split('_')[0].toUpperCase();
}

export function isOnrampSupported(asset: string): boolean {
  return Object.prototype.hasOwnProperty.call(ONRAMP_ASSET_MAP, asset);
}

/** Network id to the chain code used elsewhere in the codebase. */
const NETWORK_TO_CHAIN: Record<string, string> = {
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  ethereum: 'ETH',
  polygon: 'POL',
  solana: 'SOL',
  bsc: 'BNB',
  dogecoin: 'DOGE',
  ripple: 'XRP',
  cardano: 'ADA',
  base: 'BASE',
};

/**
 * The chains whose address format `validateAddress` can actually judge.
 *
 * Anything outside this set has no validator, so a destination on it is
 * accepted unchecked.
 */
const ADDRESS_FORMAT_OF: Record<string, string> = {
  BTC: 'BTC',
  BCH: 'BCH',
  ETH: 'ETH',
  POL: 'POL',
  SOL: 'SOL',
  // Base is an EVM chain: its addresses *are* Ethereum addresses, so ETH is
  // the right validator rather than no validator. Without this line a Base
  // purchase would skip validation altogether and a Solana address would sail
  // through into a flow that can never deliver to it.
  BASE: 'ETH',
};

/**
 * The chain an asset actually settles on — `USDC_POL` settles on POL, not USDC.
 *
 * This is the truthful answer, and what to show a user or record on an order.
 * For deciding how to validate a destination address, use
 * {@link addressFormatChain} instead: those differ on EVM L2s, where the
 * settlement chain is Base but the address format is Ethereum's.
 */
export function settlementChain(cryptoAsset: string): string | null {
  const mapping = ONRAMP_ASSET_MAP[cryptoAsset];
  return mapping ? NETWORK_TO_CHAIN[mapping.network] ?? null : null;
}

/**
 * The chain whose address format a destination must satisfy, or null when we
 * have no validator for it.
 *
 * A Polygon USDC purchase sent to a Solana address is unrecoverable and the
 * ramp will not check for us, so this is the last line of defence before a
 * user's money leaves for an address that can never receive it.
 */
export function addressFormatChain(cryptoAsset: string): string | null {
  const chain = settlementChain(cryptoAsset);
  return chain ? ADDRESS_FORMAT_OF[chain] ?? null : null;
}
