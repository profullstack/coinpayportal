/**
 * Tatum API Fee Estimation Service
 * Provides real-time network fee estimates for various blockchains
 *
 * Tatum API Documentation:
 * - Gas Price: https://apidoc.tatum.io/tag/Gas-pump
 * - Bitcoin Fee: https://apidoc.tatum.io/tag/Bitcoin#operation/BtcGetFee
 * - Solana Fee: https://apidoc.tatum.io/tag/Solana#operation/SolanaGetFee
 */

import { getExchangeRate } from './tatum';
import { fetchWithRetry } from '../utils/retry';

const TATUM_API_BASE = 'https://api.tatum.io';

/**
 * Retry configuration for Tatum API calls
 * 3 attempts with 100ms base delay (100ms, 200ms, 400ms)
 */
const TATUM_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 100,
};

/** Keyless fallbacks: one quick retry, the next source is the real fallback. */
const KEYLESS_RETRY_CONFIG = {
  maxRetries: 2,
  baseDelayMs: 100,
};

/**
 * Fee cache to minimize API calls
 */
interface CachedFee {
  value: number;
  timestamp: number;
}

const feeCache = new Map<string, CachedFee>();
const FEE_CACHE_TTL = 60 * 1000; // 1 minute cache for fees (more volatile than rates)

/**
 * Static fees for chains with predictable/low fees (not worth API calls)
 * These are real expected values, not fallbacks
 */
const STATIC_FEES_USD: Record<string, number> = {
  'BCH': 0.01,    // Bitcoin Cash: very low fees
  'DOGE': 0.05,   // Dogecoin: ~$0.01-0.10
  'XRP': 0.001,   // Ripple: very low fees
  'ADA': 0.20,    // Cardano: ~$0.15-0.30
  'BNB': 0.10,    // Binance Smart Chain: ~$0.05-0.20
};

/**
 * Base (USDC_BASE): an L2 ERC-20 transfer is fractions of a cent; a sweep is
 * two transfers plus the relayer's gas top-up. Payments on USDC_BASE were
 * refused with "Unsupported blockchain for fee estimation: BASE" while
 * /api/supported-coins advertised the chain. Kept out of STATIC_FEES_USD,
 * which is keyed by payable symbols (BASE is a network, not a coin).
 */
const BASE_FEE_USD = 0.02;

/**
 * Get Tatum API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.TATUM_API_KEY;
  if (!apiKey) {
    throw new Error('TATUM_API_KEY environment variable is not set');
  }
  return apiKey;
}

/**
 * Check if cached fee is still valid
 */
function isCacheValid(cached: CachedFee): boolean {
  return Date.now() - cached.timestamp < FEE_CACHE_TTL;
}

/**
 * Estimate Bitcoin transaction fee in USD
 * Uses Tatum's unified fee endpoint: GET /v3/blockchain/fee/{chain}
 */
async function tatumBitcoinSatPerByte(): Promise<number> {
  const apiKey = getApiKey();

  // Get recommended fee (satoshis per byte) from unified endpoint
  const response = await fetchWithRetry(
    `${TATUM_API_BASE}/v3/blockchain/fee/BTC`,
    {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    },
    TATUM_RETRY_CONFIG
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tatum API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { slow?: number; medium?: number; fast?: number };
  console.log('[Fee] BTC fee data:', data);

  // Use "medium" fee for balance between speed and cost
  // Fee is in satoshis per byte
  return data.medium ?? data.fast ?? 20;
}

/**
 * Keyless BTC fee rate (sat/vB, ~30 minute target): mempool.space, then
 * blockstream.info. Used when Tatum fails; a Tatum plan running out (402
 * "Your plan limit has been exceeded", 2026-11-22) refused every BTC and
 * ETH payment, because fee estimation had no other source.
 */
async function keylessBitcoinSatPerByte(): Promise<number> {
  try {
    const res = await fetchWithRetry('https://mempool.space/api/v1/fees/recommended', { method: 'GET' }, KEYLESS_RETRY_CONFIG);
    if (res.ok) {
      const d = (await res.json()) as { halfHourFee?: number; hourFee?: number; fastestFee?: number };
      const v = d.halfHourFee ?? d.hourFee ?? d.fastestFee;
      if (typeof v === 'number' && v > 0) return v;
    }
  } catch (e) {
    console.warn('[Fee] mempool.space fee lookup failed:', e instanceof Error ? e.message : e);
  }
  const res = await fetchWithRetry('https://blockstream.info/api/fee-estimates', { method: 'GET' }, KEYLESS_RETRY_CONFIG);
  if (!res.ok) throw new Error(`blockstream fee-estimates error: ${res.status}`);
  const d = (await res.json()) as Record<string, number>;
  const v = d['3'] ?? d['6'] ?? d['2'];
  if (typeof v !== 'number' || !(v > 0)) throw new Error('blockstream fee-estimates returned no rate');
  return v;
}

async function estimateBitcoinFee(): Promise<number> {
  let satoshisPerByte: number;
  try {
    satoshisPerByte = await tatumBitcoinSatPerByte();
  } catch (e) {
    console.warn('[Fee] Tatum BTC fee failed, using keyless source:', e instanceof Error ? e.message : e);
    satoshisPerByte = await keylessBitcoinSatPerByte();
  }
  const avgTxSize = 250; // Average transaction size in bytes
  const feeInSatoshis = satoshisPerByte * avgTxSize;
  const feeInBtc = feeInSatoshis / 100000000;

  // Convert to USD
  const btcPrice = await getExchangeRate('BTC', 'USD');
  return feeInBtc * btcPrice;
}

/**
 * Estimate Ethereum transaction fee in USD
 * Uses Tatum's unified fee endpoint: GET /v3/blockchain/fee/{chain}
 */
async function tatumEthereumGasPriceWei(): Promise<number> {
  const apiKey = getApiKey();

  // Get current gas price from unified endpoint
  const response = await fetchWithRetry(
    `${TATUM_API_BASE}/v3/blockchain/fee/ETH`,
    {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    },
    TATUM_RETRY_CONFIG
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tatum API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    gasPrice?: { slow?: number; medium?: number; fast?: number };
    baseFee?: number;
    slow?: number;
    medium?: number;
    fast?: number;
  };
  console.log('[Fee] ETH fee data:', data);

  // Gas price can be nested under gasPrice or at root level
  // Value is in wei
  return data.gasPrice?.medium ?? data.gasPrice?.fast ?? data.medium ?? data.fast ?? 30000000000;
}

/** Ethereum JSON-RPC endpoints for eth_gasPrice when Tatum fails: ours first, then keyless public ones. */
function ethereumRpcUrls(): string[] {
  const own = [process.env.ETHEREUM_RPC_URL, process.env.ETH_RPC_URL].filter((u): u is string => Boolean(u));
  return [...new Set([...own, 'https://ethereum-rpc.publicnode.com', 'https://1rpc.io/eth', 'https://eth.drpc.org', 'https://rpc.mevblocker.io'])];
}

async function keylessEthereumGasPriceWei(): Promise<number> {
  let lastError: unknown;
  for (const url of ethereumRpcUrls()) {
    try {
      const res = await fetchWithRetry(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) },
        KEYLESS_RETRY_CONFIG
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { result?: string };
      const wei = d.result ? Number(BigInt(d.result)) : NaN;
      if (Number.isFinite(wei) && wei > 0) return wei;
      throw new Error('no result');
    } catch (e) {
      lastError = e;
      console.warn(`[Fee] eth_gasPrice via ${new URL(url).host} failed:`, e instanceof Error ? e.message : e);
    }
  }
  throw new Error(`No Ethereum gas price source answered: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function estimateEthereumFee(): Promise<number> {
  let gasPriceWei: number;
  try {
    gasPriceWei = await tatumEthereumGasPriceWei();
  } catch (e) {
    console.warn('[Fee] Tatum ETH fee failed, using keyless source:', e instanceof Error ? e.message : e);
    gasPriceWei = await keylessEthereumGasPriceWei();
  }
  const gasLimit = 65000; // Use higher estimate for token transfers
  const feeInWei = gasPriceWei * gasLimit;
  const feeInEth = feeInWei / 1e18;

  // Convert to USD
  const ethPrice = await getExchangeRate('ETH', 'USD');
  return feeInEth * ethPrice;
}

/**
 * Estimate Polygon transaction fee in USD
 * Uses Polygon's public Gas Station API: https://gasstation.polygon.technology/v2
 */
async function estimatePolygonFee(): Promise<number> {
  // Get current gas price from Polygon Gas Station (public API, no key required)
  const response = await fetchWithRetry(
    'https://gasstation.polygon.technology/v2',
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    TATUM_RETRY_CONFIG
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Polygon Gas Station API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    standard?: { maxFee?: number };
    fast?: { maxFee?: number };
    estimatedBaseFee?: number;
  };
  console.log('[Fee] Polygon gas data:', data);

  // Gas price is in Gwei
  const gasPriceGwei = data.standard?.maxFee ?? data.fast?.maxFee ?? data.estimatedBaseFee ?? 100;
  const gasLimit = 65000;
  const feeInGwei = gasPriceGwei * gasLimit;
  const feeInMatic = feeInGwei / 1e9;

  // Convert to USD (POL is the new symbol for Polygon's native token)
  const polPrice = await getExchangeRate('POL', 'USD');
  return feeInMatic * polPrice;
}

/**
 * Estimate Solana transaction fee in USD
 * Solana has very predictable fees
 */
async function estimateSolanaFee(): Promise<number> {
  // Solana fees are very predictable: 5000 lamports per signature
  // Most transactions have 1-2 signatures
  const lamportsPerSignature = 5000;
  const signatures = 2; // Conservative estimate
  const feeInLamports = lamportsPerSignature * signatures;
  const feeInSol = feeInLamports / 1000000000;

  // Convert to USD
  const solPrice = await getExchangeRate('SOL', 'USD');
  return feeInSol * solPrice;
}

/**
 * USDT (TRC-20) sweep cost in USD.
 *
 * A sweep is two token transfers (merchant, then platform) out of a brand-new
 * deposit address, paid for in TRX the gas relayer sends it first. Each
 * transfer to an address that already holds USDT burns ~64,285 energy (to one
 * that never has, ~130k); activating the new deposit account costs the relayer
 * 1.1 TRX, and each transfer ~350 bytes of bandwidth. Energy and bandwidth
 * prices are read from the chain, so a governance change to the energy price
 * moves the quote with it.
 */
export const TRON_TRANSFER_ENERGY = 64_285;
export const TRON_SWEEP_TRANSFERS = 2;

async function estimateTronUsdtFee(): Promise<number> {
  const { getChainFees } = await import('@/lib/tron/client');
  const { energyFeeSun, bandwidthFeeSun } = await getChainFees();
  const sun =
    BigInt(TRON_TRANSFER_ENERGY * TRON_SWEEP_TRANSFERS) * energyFeeSun +
    BigInt(350 * TRON_SWEEP_TRANSFERS) * bandwidthFeeSun +
    1_100_000n; // account activation + the top-up's own bandwidth
  const trxPrice = await getExchangeRate('TRX', 'USD');
  return (Number(sun) / 1e6) * trxPrice;
}

/**
 * Get estimated network fee for a blockchain in USD
 * Uses Tatum API for real-time estimates with caching
 * 
 * @param blockchain - The blockchain to estimate fees for
 * @returns Estimated fee in USD
 */
export async function getEstimatedNetworkFee(blockchain: string): Promise<number> {
  // Normalize blockchain name (handle USDC variants)
  const baseChain = blockchain.startsWith('USDC_')
    ? blockchain.replace('USDC_', '')
    : blockchain.startsWith('USDT_')
    ? blockchain.replace('USDT_', '')
    : blockchain;

  // Check cache first
  const cacheKey = `fee_${baseChain}`;
  const cached = feeCache.get(cacheKey);

  if (cached && isCacheValid(cached)) {
    return cached.value;
  }

  let fee: number;

  switch (baseChain) {
    case 'BTC':
      fee = await estimateBitcoinFee();
      break;
    case 'ETH':
      fee = await estimateEthereumFee();
      break;
    case 'POL':
      fee = await estimatePolygonFee();
      break;
    case 'SOL':
      fee = await estimateSolanaFee();
      break;
    case 'BCH':
    case 'DOGE':
    case 'XRP':
    case 'ADA':
    case 'BNB':
      // These chains have predictable low fees, use static values
      fee = STATIC_FEES_USD[baseChain];
      break;
    case 'USDT':
    case 'USDC':
      // Stablecoins on Ethereum, use ETH fee estimate
      fee = await estimateEthereumFee();
      break;
    case 'BASE':
      fee = BASE_FEE_USD;
      break;
    case 'TRON':
      fee = await estimateTronUsdtFee();
      break;
    default:
      throw new Error(`Unsupported blockchain for fee estimation: ${baseChain}`);
  }

  // Add 20% buffer for fee volatility
  fee = fee * 1.2;

  // Round to 2 decimal places
  fee = Math.round(fee * 100) / 100;

  // Ensure minimum fee of $0.01
  fee = Math.max(fee, 0.01);

  // Cache the result
  feeCache.set(cacheKey, {
    value: fee,
    timestamp: Date.now(),
  });

  console.log(`[Fee] Estimated ${baseChain} fee: $${fee}`);
  return fee;
}

/**
 * Get estimated fees for multiple blockchains
 */
export async function getEstimatedNetworkFees(
  blockchains: string[]
): Promise<Record<string, number>> {
  const fees: Record<string, number> = {};
  
  await Promise.all(
    blockchains.map(async (blockchain) => {
      fees[blockchain] = await getEstimatedNetworkFee(blockchain);
    })
  );
  
  return fees;
}

/**
 * Clear the fee cache (useful for testing)
 */
export function clearFeeCache(): void {
  feeCache.clear();
}

/**
 * Get static fees for chains with predictable fees
 */
export function getStaticFees(): Record<string, number> {
  return { ...STATIC_FEES_USD };
}
