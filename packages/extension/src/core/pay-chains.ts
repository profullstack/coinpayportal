/**
 * Payment-chain vocabulary shared by the batch payer.
 *
 * Three different names for "what coin is this" show up in a batch payment and
 * they are NOT interchangeable:
 *
 *   1. `PayChain`  — what the CoinPay server's prepare-tx/broadcast API calls it
 *                    (`USDC_POL`). This decides fees, contract address, RPC.
 *   2. signing key — which derived key signs it. USDC_POL rides on the POL/ETH
 *                    address, so it signs with the `ETH`-path secp256k1 key.
 *   3. wire currency — the lowercase code payment providers hand us
 *                      (`usdc_pol`), e.g. ugig.net invoice metadata.
 *
 * `toPayChain()` normalizes (3) → (1); `signingChain()` maps (1) → (2).
 */

import type { NativeChain } from './chains.js';

/** Chains the CoinPay web-wallet API accepts AND this extension can sign. */
export type PayChain =
  | 'BTC'
  | 'BCH'
  | 'ETH'
  | 'POL'
  | 'SOL'
  | 'USDC_ETH'
  | 'USDC_POL'
  | 'USDC_SOL'
  | 'USDT_ETH'
  | 'USDT_POL'
  | 'USDT_SOL';

export const PAY_CHAINS: readonly PayChain[] = [
  'BTC',
  'BCH',
  'ETH',
  'POL',
  'SOL',
  'USDC_ETH',
  'USDC_POL',
  'USDC_SOL',
  'USDT_ETH',
  'USDT_POL',
  'USDT_SOL',
];

export function isPayChain(value: string): value is PayChain {
  return (PAY_CHAINS as readonly string[]).includes(value);
}

/**
 * Which derived key signs for this chain. Tokens have no key of their own —
 * they ride on the base chain's address (USDC_POL → the EVM key, USDC_SOL →
 * the Solana key), matching `CHAINS[*].tokens` in chains.ts.
 */
const SIGNING_CHAIN: Record<PayChain, NativeChain> = {
  BTC: 'BTC',
  BCH: 'BCH',
  ETH: 'ETH',
  POL: 'POL',
  SOL: 'SOL',
  USDC_ETH: 'ETH',
  USDC_POL: 'POL',
  USDC_SOL: 'SOL',
  USDT_ETH: 'ETH',
  USDT_POL: 'POL',
  USDT_SOL: 'SOL',
};

export function signingChain(chain: PayChain): NativeChain {
  return SIGNING_CHAIN[chain];
}

/**
 * Transactions on the same chain must be prepared and broadcast one at a time
 * (an EVM nonce or a BTC UTXO set only advances once the previous tx is out).
 * ETH and USDC_ETH share an account, so they share a queue — this key is what
 * the batch runner serializes on.
 */
export function nonceQueueKey(chain: PayChain): NativeChain {
  const signer = SIGNING_CHAIN[chain];
  // POL and ETH are distinct networks with independent nonces despite the
  // shared address, so the signing chain is already the right granularity.
  return signer;
}

/**
 * Normalize a wire currency code to a `PayChain`.
 *
 * Accepts what CoinPay payment records use (`usdc_pol`, `btc`), plain tickers
 * (`USDC`, `MATIC`), and already-normalized chains (`USDC_POL`).
 * Returns null for anything this extension cannot sign — the caller surfaces
 * that as a skipped payment rather than guessing a chain.
 */
export function toPayChain(value: string | null | undefined): PayChain | null {
  const normalized = (value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  if (isPayChain(normalized)) return normalized;

  switch (normalized) {
    case 'MATIC':
      return 'POL';
    // Bare `USDC`/`USDT` are ambiguous across chains. CoinPay's own
    // `preferredCoinToPaymentCurrency` resolves bare USDC to Solana, so we
    // match that rather than inventing a different default.
    case 'USDC':
      return 'USDC_SOL';
    case 'USDT':
      return 'USDT_SOL';
    default:
      return null;
  }
}

/**
 * The coin ticker a chain actually moves — `USDC_POL` sends USDC, not POL.
 * Used for amount labels and as the `coin` parameter to `GET /api/rates`,
 * which resolves tokens to their own (stablecoin) rate rather than the base
 * chain's.
 */
export function payChainTicker(chain: PayChain): string {
  return chain.split('_')[0] ?? chain;
}

/** Display label for the approval screen. */
export function payChainLabel(chain: PayChain): string {
  switch (chain) {
    case 'BTC':
      return 'Bitcoin';
    case 'BCH':
      return 'Bitcoin Cash';
    case 'ETH':
      return 'Ethereum';
    case 'POL':
      return 'Polygon';
    case 'SOL':
      return 'Solana';
    case 'USDC_ETH':
      return 'USDC on Ethereum';
    case 'USDC_POL':
      return 'USDC on Polygon';
    case 'USDC_SOL':
      return 'USDC on Solana';
    case 'USDT_ETH':
      return 'USDT on Ethereum';
    case 'USDT_POL':
      return 'USDT on Polygon';
    case 'USDT_SOL':
      return 'USDT on Solana';
  }
}
