/**
 * Block-explorer links for transaction hashes.
 *
 * The first eight mirror the portal's own map (`EXPLORER_URLS` in
 * src/lib/web-wallet/broadcast.ts) so a transaction opens the same page
 * wherever the user clicks it. The rest cover assets the extension lists but
 * the portal does not broadcast.
 *
 * Token transfers are ordinary transactions on their host chain, so USDC on
 * Polygon resolves to Polygonscan, not to some token-specific site.
 */
const EXPLORER_TX_URLS: Record<string, string> = {
  // Mirrors the portal.
  BTC: 'https://blockstream.info/tx/',
  BCH: 'https://blockchair.com/bitcoin-cash/transaction/',
  ETH: 'https://etherscan.io/tx/',
  POL: 'https://polygonscan.com/tx/',
  SOL: 'https://explorer.solana.com/tx/',
  USDC_ETH: 'https://etherscan.io/tx/',
  USDC_POL: 'https://polygonscan.com/tx/',
  USDC_SOL: 'https://explorer.solana.com/tx/',
  // Assets the extension displays but the portal does not broadcast.
  USDT_ETH: 'https://etherscan.io/tx/',
  USDT_POL: 'https://polygonscan.com/tx/',
  USDT_SOL: 'https://explorer.solana.com/tx/',
  USDC_BASE: 'https://basescan.org/tx/',
  BNB: 'https://bscscan.com/tx/',
  DOGE: 'https://blockchair.com/dogecoin/transaction/',
  XRP: 'https://xrpscan.com/tx/',
  ADA: 'https://cardanoscan.io/transaction/',
  // LN is deliberately absent: Lightning payments never hit a chain, so there
  // is nothing for an explorer to show. A link would be a dead end.
};

/**
 * Explorer URL for a transaction, or null when the asset has no public
 * explorer (Lightning) or the hash is missing.
 */
export function explorerTxUrl(chain: string, txHash: string): string | null {
  const base = EXPLORER_TX_URLS[chain?.toUpperCase()];
  const hash = txHash?.trim();
  if (!base || !hash) return null;
  return base + encodeURIComponent(hash);
}

export function hasExplorer(chain: string): boolean {
  return Boolean(EXPLORER_TX_URLS[chain?.toUpperCase()]);
}
