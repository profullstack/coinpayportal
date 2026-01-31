/**
 * Web Wallet Fee Estimation Service
 *
 * Estimates network fees for all supported chains.
 * Uses direct HTTP calls — no ethers.js dependency.
 * Results cached for 60 seconds to minimize API calls.
 */

import type { WalletChain } from './identity';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface FeeEstimate {
  chain: WalletChain;
  /** Estimated fee in the chain's native currency */
  fee: string;
  /** Fee currency symbol (ETH, BTC, SOL, etc.) */
  feeCurrency: string;
  /** Priority level */
  priority: 'low' | 'medium' | 'high';
  /** For EVM: gas limit */
  gasLimit?: number;
  /** For EVM: gas price in wei */
  gasPrice?: string;
  /** For EVM: max fee per gas (EIP-1559) */
  maxFeePerGas?: string;
  /** For EVM: max priority fee per gas (EIP-1559) */
  maxPriorityFeePerGas?: string;
  /** For BTC/BCH: fee rate in sat/byte */
  feeRate?: number;
  /** Estimated time to confirmation */
  estimatedSeconds?: number;
}

export interface FeeEstimateResult {
  low: FeeEstimate;
  medium: FeeEstimate;
  high: FeeEstimate;
}

// ──────────────────────────────────────────────
// Cache
// ──────────────────────────────────────────────

interface CachedFee {
  result: FeeEstimateResult;
  timestamp: number;
}

const feeCache = new Map<string, CachedFee>();
const CACHE_TTL_MS = 60_000; // 1 minute

export function clearFeeCache(): void {
  feeCache.clear();
}

// ──────────────────────────────────────────────
// RPC Endpoints
// ──────────────────────────────────────────────

function getRpcEndpoints(): Record<string, string> {
  return {
    BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
    ETH: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    POL: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    SOL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };
}

// ──────────────────────────────────────────────
// Gas Limits
// ──────────────────────────────────────────────

/** Standard gas limits for different transaction types */
const GAS_LIMITS = {
  ETH_TRANSFER: 21_000,
  ERC20_TRANSFER: 65_000,
  ERC20_APPROVE: 50_000,
};

// ──────────────────────────────────────────────
// BTC / BCH Fee Estimation
// ──────────────────────────────────────────────

/** Average BTC transaction size in bytes (1 input, 2 outputs, P2WPKH) */
const AVG_BTC_TX_SIZE = 250;

async function estimateBTCFees(): Promise<FeeEstimateResult> {
  // Try mempool.space API for fee rate (sat/vB)
  try {
    const resp = await fetch('https://mempool.space/api/v1/fees/recommended');
    if (resp.ok) {
      const data = await resp.json();
      return {
        low: makeBTCFee(data.hourFee || 5, 'low', 3600),
        medium: makeBTCFee(data.halfHourFee || 10, 'medium', 1800),
        high: makeBTCFee(data.fastestFee || 20, 'high', 600),
      };
    }
  } catch { /* fall through */ }

  // Try Tatum API fallback
  const tatumKey = process.env.TATUM_API_KEY;
  if (tatumKey) {
    try {
      const resp = await fetch('https://api.tatum.io/v3/blockchain/fee/BTC', {
        headers: { 'x-api-key': tatumKey },
      });
      if (resp.ok) {
        const data = await resp.json();
        return {
          low: makeBTCFee(data.slow || 5, 'low', 3600),
          medium: makeBTCFee(data.medium || 10, 'medium', 1800),
          high: makeBTCFee(data.fast || 20, 'high', 600),
        };
      }
    } catch { /* fall through */ }
  }

  // Default fallback
  return {
    low: makeBTCFee(5, 'low', 3600),
    medium: makeBTCFee(10, 'medium', 1800),
    high: makeBTCFee(20, 'high', 600),
  };
}

function makeBTCFee(satPerByte: number, priority: 'low' | 'medium' | 'high', estSeconds: number): FeeEstimate {
  const feeSats = satPerByte * AVG_BTC_TX_SIZE;
  return {
    chain: 'BTC',
    fee: (feeSats / 1e8).toString(),
    feeCurrency: 'BTC',
    priority,
    feeRate: satPerByte,
    estimatedSeconds: estSeconds,
  };
}

async function estimateBCHFees(): Promise<FeeEstimateResult> {
  // BCH has consistently low fees; use fixed rates
  const satPerByte = 1; // BCH is ~1 sat/byte
  return {
    low: { chain: 'BCH', fee: (satPerByte * AVG_BTC_TX_SIZE / 1e8).toString(), feeCurrency: 'BCH', priority: 'low', feeRate: satPerByte, estimatedSeconds: 3600 },
    medium: { chain: 'BCH', fee: (2 * AVG_BTC_TX_SIZE / 1e8).toString(), feeCurrency: 'BCH', priority: 'medium', feeRate: 2, estimatedSeconds: 600 },
    high: { chain: 'BCH', fee: (5 * AVG_BTC_TX_SIZE / 1e8).toString(), feeCurrency: 'BCH', priority: 'high', feeRate: 5, estimatedSeconds: 300 },
  };
}

// ──────────────────────────────────────────────
// EVM Fee Estimation (ETH / POL)
// ──────────────────────────────────────────────

async function estimateEVMFees(
  chain: 'ETH' | 'POL' | 'USDC_ETH' | 'USDC_POL',
  rpcUrl: string
): Promise<FeeEstimateResult> {
  const isToken = chain.startsWith('USDC_');
  const gasLimit = isToken ? GAS_LIMITS.ERC20_TRANSFER : GAS_LIMITS.ETH_TRANSFER;
  const nativeCurrency = chain.includes('ETH') ? 'ETH' : 'POL';
  const baseChain = chain.includes('ETH') ? 'ETH' : 'POL';

  // Fetch current gas prices via eth_gasPrice and eth_maxPriorityFeePerGas
  const [gasPriceResp, baseFeeResp] = await Promise.all([
    fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
    }),
    fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_maxPriorityFeePerGas', params: [], id: 2 }),
    }).catch(() => null), // EIP-1559 may not be supported
  ]);

  if (!gasPriceResp.ok) {
    throw new Error(`${chain} gas price fetch failed: ${gasPriceResp.status}`);
  }

  const gasPriceData = await gasPriceResp.json();
  const gasPrice = BigInt(gasPriceData.result || '0x0');

  let maxPriorityFee = gasPrice / 10n; // Default: 10% of gas price as priority fee
  if (baseFeeResp?.ok) {
    const priorityData = await baseFeeResp.json();
    if (priorityData.result) {
      maxPriorityFee = BigInt(priorityData.result);
    }
  }

  // Calculate fees for each priority
  const lowGasPrice = gasPrice;
  const medGasPrice = gasPrice + maxPriorityFee;
  const highGasPrice = gasPrice + maxPriorityFee * 2n;

  return {
    low: makeEVMFee(baseChain as WalletChain, nativeCurrency, gasLimit, lowGasPrice, maxPriorityFee / 2n, 'low', chain.includes('ETH') ? 300 : 30),
    medium: makeEVMFee(baseChain as WalletChain, nativeCurrency, gasLimit, medGasPrice, maxPriorityFee, 'medium', chain.includes('ETH') ? 60 : 10),
    high: makeEVMFee(baseChain as WalletChain, nativeCurrency, gasLimit, highGasPrice, maxPriorityFee * 2n, 'high', chain.includes('ETH') ? 15 : 5),
  };
}

function makeEVMFee(
  chain: WalletChain,
  currency: string,
  gasLimit: number,
  gasPrice: bigint,
  priorityFee: bigint,
  priority: 'low' | 'medium' | 'high',
  estSeconds: number
): FeeEstimate {
  const totalWei = gasPrice * BigInt(gasLimit);
  const fee = Number(totalWei) / 1e18;

  return {
    chain,
    fee: fee.toString(),
    feeCurrency: currency,
    priority,
    gasLimit,
    gasPrice: gasPrice.toString(),
    maxFeePerGas: gasPrice.toString(),
    maxPriorityFeePerGas: priorityFee.toString(),
    estimatedSeconds: estSeconds,
  };
}

// ──────────────────────────────────────────────
// SOL Fee Estimation
// ──────────────────────────────────────────────

/** Base fee per signature in lamports */
const SOL_BASE_FEE_LAMPORTS = 5000;

async function estimateSOLFees(
  chain: 'SOL' | 'USDC_SOL',
  rpcUrl: string
): Promise<FeeEstimateResult> {
  // SOL fees are deterministic (5000 lamports per signature)
  // Priority fees come from recent block data
  let priorityFee = 0;

  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getRecentPrioritizationFees',
        params: [],
        id: 1,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const fees = data.result || [];
      if (fees.length > 0) {
        // Use median priority fee
        const sorted = fees.map((f: any) => f.prioritizationFee).sort((a: number, b: number) => a - b);
        priorityFee = sorted[Math.floor(sorted.length / 2)] || 0;
      }
    }
  } catch { /* use default */ }

  // For USDC_SOL, account for token program invocation (more compute units)
  const signatures = chain === 'USDC_SOL' ? 1 : 1;
  const baseFee = SOL_BASE_FEE_LAMPORTS * signatures;

  return {
    low: {
      chain: chain === 'USDC_SOL' ? 'SOL' : chain,
      fee: (baseFee / 1e9).toString(),
      feeCurrency: 'SOL',
      priority: 'low',
      estimatedSeconds: 30,
    },
    medium: {
      chain: chain === 'USDC_SOL' ? 'SOL' : chain,
      fee: ((baseFee + priorityFee) / 1e9).toString(),
      feeCurrency: 'SOL',
      priority: 'medium',
      estimatedSeconds: 10,
    },
    high: {
      chain: chain === 'USDC_SOL' ? 'SOL' : chain,
      fee: ((baseFee + priorityFee * 3) / 1e9).toString(),
      feeCurrency: 'SOL',
      priority: 'high',
      estimatedSeconds: 5,
    },
  };
}

// ──────────────────────────────────────────────
// Unified Fee Estimation
// ──────────────────────────────────────────────

/**
 * Estimate network fees for a given chain.
 * Results are cached for 60 seconds.
 */
export async function estimateFees(chain: WalletChain): Promise<FeeEstimateResult> {
  // Check cache
  const cached = feeCache.get(chain);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const rpc = getRpcEndpoints();
  let result: FeeEstimateResult;

  switch (chain) {
    case 'BTC':
      result = await estimateBTCFees();
      break;
    case 'BCH':
      result = await estimateBCHFees();
      break;
    case 'ETH':
    case 'USDC_ETH':
      result = await estimateEVMFees(chain, rpc.ETH);
      break;
    case 'POL':
    case 'USDC_POL':
      result = await estimateEVMFees(chain, rpc.POL);
      break;
    case 'SOL':
    case 'USDC_SOL':
      result = await estimateSOLFees(chain, rpc.SOL);
      break;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }

  feeCache.set(chain, { result, timestamp: Date.now() });
  return result;
}

// Export for testing
export { GAS_LIMITS, AVG_BTC_TX_SIZE, SOL_BASE_FEE_LAMPORTS };
