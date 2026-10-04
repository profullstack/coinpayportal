/**
 * The networks the explorer serves.
 *
 * Deliberately the settlement networks CoinPay itself takes money on, so the
 * explorer can resolve any transaction the platform produces. Base is here
 * even though it is absent from the marketing chain list, because USDC_BASE
 * settles on it and those transactions need somewhere to resolve.
 */

import type { ExplorerChain } from './types';

export const EXPLORER_CHAINS: readonly ExplorerChain[] = [
  { id: 'btc', name: 'Bitcoin', symbol: 'BTC', family: 'utxo', decimals: 8 },
  { id: 'bch', name: 'Bitcoin Cash', symbol: 'BCH', family: 'utxo', decimals: 8 },
  { id: 'doge', name: 'Dogecoin', symbol: 'DOGE', family: 'utxo', decimals: 8 },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', family: 'evm', decimals: 18 },
  { id: 'pol', name: 'Polygon', symbol: 'POL', family: 'evm', decimals: 18 },
  { id: 'bnb', name: 'BNB Chain', symbol: 'BNB', family: 'evm', decimals: 18 },
  { id: 'base', name: 'Base', symbol: 'ETH', family: 'evm', decimals: 18 },
  { id: 'sol', name: 'Solana', symbol: 'SOL', family: 'solana', decimals: 9 },
  { id: 'xrp', name: 'XRP Ledger', symbol: 'XRP', family: 'xrp', decimals: 6 },
  { id: 'ada', name: 'Cardano', symbol: 'ADA', family: 'cardano', decimals: 6 },
];

export function getChain(id: string): ExplorerChain | undefined {
  return EXPLORER_CHAINS.find((c) => c.id === id.toLowerCase());
}

/** EVM chain ids, for JSON-RPC and the Etherscan V2 `chainid` parameter. */
export const EVM_CHAIN_IDS: Record<string, number> = {
  eth: 1,
  pol: 137,
  bnb: 56,
  base: 8453,
};

/**
 * JSON-RPC endpoints per EVM chain.
 *
 * Same precedence as the payment monitor so the explorer and the monitor never
 * disagree about what the chain says. The defaults are the keyless endpoints
 * verified working; llamarpc and polygon-rpc.com are deliberately absent
 * because both stopped answering (see PR #321).
 */
export function evmRpcUrl(chainId: string): string {
  switch (chainId) {
    case 'eth':
      return process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com';
    case 'pol':
      return process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
    case 'bnb':
      return (
        process.env.BNB_RPC_URL || process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'
      );
    case 'base':
      return process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    default:
      throw new Error(`Not an EVM chain: ${chainId}`);
  }
}

export function solanaRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    'https://api.mainnet-beta.solana.com'
  );
}
