/**
 * Asset registry: CoinPay symbol -> chain facts and provider identifiers.
 *
 * Only assets the CoinPay web wallet can hold are listed, so a swap can never
 * deliver into something the user cannot see or spend. THORChain asset ids
 * were checked against /thorchain/pools (status Available) on 2026-11-22.
 */

import type { ExchangeAsset } from './types';

export interface AssetInfo {
  symbol: ExchangeAsset;
  name: string;
  /** Wallet chain the asset lives on (for address validation and sending). */
  chain: string;
  decimals: number;
  /** THORChain pool asset, when THORChain has an Available pool for it. */
  thorchain?: string;
  /** EVM token contract, checksummed. */
  contract?: string;
}

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSETS: AssetInfo[] = [
  { symbol: 'BTC', name: 'Bitcoin', chain: 'BTC', decimals: 8, thorchain: 'BTC.BTC' },
  { symbol: 'BCH', name: 'Bitcoin Cash', chain: 'BCH', decimals: 8, thorchain: 'BCH.BCH' },
  { symbol: 'ETH', name: 'Ethereum', chain: 'ETH', decimals: 18, thorchain: 'ETH.ETH' },
  { symbol: 'SOL', name: 'Solana', chain: 'SOL', decimals: 9, thorchain: 'SOL.SOL' },
  { symbol: 'BNB', name: 'BNB (BSC)', chain: 'BNB', decimals: 18, thorchain: 'BSC.BNB' },
  { symbol: 'DOGE', name: 'Dogecoin', chain: 'DOGE', decimals: 8, thorchain: 'DOGE.DOGE' },
  { symbol: 'XRP', name: 'XRP', chain: 'XRP', decimals: 6, thorchain: 'XRP.XRP' },
  { symbol: 'POL', name: 'Polygon', chain: 'POL', decimals: 18 },
  { symbol: 'ADA', name: 'Cardano', chain: 'ADA', decimals: 6 },
  {
    symbol: 'USDC_ETH', name: 'USDC (Ethereum)', chain: 'ETH', decimals: 6, contract: USDC_ETH,
    thorchain: `ETH.USDC-${USDC_ETH.toUpperCase()}`,
  },
  {
    symbol: 'USDT_ETH', name: 'USDT (Ethereum)', chain: 'ETH', decimals: 6, contract: USDT_ETH,
    thorchain: `ETH.USDT-${USDT_ETH.toUpperCase()}`,
  },
  {
    symbol: 'USDC_BASE', name: 'USDC (Base)', chain: 'BASE', decimals: 6, contract: USDC_BASE,
    thorchain: `BASE.USDC-${USDC_BASE.toUpperCase()}`,
  },
  { symbol: 'USDC_POL', name: 'USDC (Polygon)', chain: 'POL', decimals: 6 },
  { symbol: 'USDC_SOL', name: 'USDC (Solana)', chain: 'SOL', decimals: 6 },
  { symbol: 'USDT_POL', name: 'USDT (Polygon)', chain: 'POL', decimals: 6 },
  { symbol: 'USDT_SOL', name: 'USDT (Solana)', chain: 'SOL', decimals: 6 },
];

/** Legacy bare symbols the old swap API accepted. */
const ALIASES: Record<string, ExchangeAsset> = { USDC: 'USDC_ETH', USDT: 'USDT_ETH' };

const BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol, a]));

export function normalizeAsset(symbol: string | null | undefined): ExchangeAsset | null {
  if (!symbol) return null;
  const up = symbol.trim().toUpperCase();
  const canon = ALIASES[up] ?? up;
  return BY_SYMBOL.has(canon) ? canon : null;
}

export function getAsset(symbol: ExchangeAsset): AssetInfo | undefined {
  return BY_SYMBOL.get(symbol);
}

export function listAssets(): AssetInfo[] {
  return [...ASSETS];
}
