/**
 * The chain list the public marketing surfaces render.
 *
 * `CRYPTO_NAMES` is the operational source of truth — it maps every symbol the
 * gateway can settle, including token variants like `USDC_BASE`. That shape is
 * wrong for a landing page: a visitor evaluating us wants to know which
 * *networks* they can take money on, and whether we are EVM-only. So this
 * derives a network-level view from it.
 *
 * The pairing is enforced by `supported-chains.test.ts`: adding a coin to
 * `CRYPTO_NAMES` without describing it here fails the suite. A homepage that
 * quietly under-sells the product is the failure mode this guards against —
 * the chain list was previously not on the homepage at all, only a bare
 * "15+" with no names, which read as "probably just EVM".
 */

import { CRYPTO_NAMES } from './supported-coins';

export interface SupportedChain {
  /** Symbol in CRYPTO_NAMES this network settles as. */
  symbol: string;
  /** Network name as a visitor would recognise it. */
  name: string;
  /** True for EVM-compatible networks — the "is this EVM-only?" question. */
  evm: boolean;
}

/**
 * Ordered by recognisability rather than alphabetically: the first few names a
 * skimmer reads should settle the "do they cover the big ones" question.
 */
export const SUPPORTED_CHAINS: readonly SupportedChain[] = [
  { symbol: 'BTC', name: 'Bitcoin', evm: false },
  { symbol: 'ETH', name: 'Ethereum', evm: true },
  { symbol: 'SOL', name: 'Solana', evm: false },
  { symbol: 'POL', name: 'Polygon', evm: true },
  { symbol: 'BNB', name: 'BNB Chain', evm: true },
  { symbol: 'XRP', name: 'XRP Ledger', evm: false },
  { symbol: 'ADA', name: 'Cardano', evm: false },
  { symbol: 'DOGE', name: 'Dogecoin', evm: false },
  { symbol: 'BCH', name: 'Bitcoin Cash', evm: false },
];

/**
 * Stablecoin rails, kept separate because they are the same asset on several
 * networks and listing them as chains would double-count.
 */
export const STABLECOIN_RAILS: readonly { asset: string; chains: readonly string[] }[] = [
  { asset: 'USDC', chains: ['Ethereum', 'Polygon', 'Solana', 'Base'] },
  { asset: 'USDT', chains: ['Ethereum', 'Polygon', 'Solana'] },
];

/**
 * Symbols in CRYPTO_NAMES that are not networks in their own right: bare
 * stablecoin tickers (aggregates over the rails above) and explicit
 * `ASSET_CHAIN` variants.
 */
export function isTokenVariant(symbol: string): boolean {
  return symbol === 'USDT' || symbol === 'USDC' || symbol.includes('_');
}

/** Every settlement symbol, for the "N assets across M chains" style claims. */
export const SETTLEMENT_ASSET_COUNT = Object.keys(CRYPTO_NAMES).length;
