/**
 * Chain metadata for the CoinPay extension.
 *
 * Mirrors the chains the CoinPay web wallet / `@profullstack/coinpay` SDK
 * derive by default. USDC variants are NOT separate keys — they live on the
 * same address as their base chain (verified against the SDK: `USDC_BASE`
 * reuses coinType 60 = the ETH address; `USDC_SOL` reuses the SOL path).
 *
 * IMPORTANT (see docs/BROWSER_EXTENSION_PRD.md §4): BTC here is legacy P2PKH
 * (`m/44'/0'`, `1...` addresses) to match the web wallet — NOT SegWit.
 */

export type NativeChain = 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL';

export interface ChainMeta {
  /** SDK chain id (as accepted by `deriveAddress`). */
  id: NativeChain;
  /** Human label. */
  label: string;
  /** Ticker for the native asset. */
  symbol: string;
  /** Smallest-unit decimals for the native asset. */
  decimals: number;
  /** Curve used for signing (informational). */
  curve: 'secp256k1' | 'ed25519';
  /** Tokens that ride on this chain's address (e.g. USDC). */
  tokens: readonly string[];
}

export const CHAINS: Record<NativeChain, ChainMeta> = {
  BTC: { id: 'BTC', label: 'Bitcoin', symbol: 'BTC', decimals: 8, curve: 'secp256k1', tokens: [] },
  BCH: { id: 'BCH', label: 'Bitcoin Cash', symbol: 'BCH', decimals: 8, curve: 'secp256k1', tokens: [] },
  ETH: { id: 'ETH', label: 'Ethereum', symbol: 'ETH', decimals: 18, curve: 'secp256k1', tokens: ['USDC'] },
  POL: { id: 'POL', label: 'Polygon', symbol: 'POL', decimals: 18, curve: 'secp256k1', tokens: ['USDC'] },
  SOL: { id: 'SOL', label: 'Solana', symbol: 'SOL', decimals: 9, curve: 'ed25519', tokens: ['USDC'] },
};

/** Default chains derived on wallet creation (matches SDK DEFAULT_CHAINS). */
export const DEFAULT_CHAINS: readonly NativeChain[] = ['BTC', 'ETH', 'SOL', 'POL', 'BCH'];

export function isNativeChain(value: string): value is NativeChain {
  return value in CHAINS;
}
