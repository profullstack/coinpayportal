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
async function estimateBitcoinFee(): Promise<number> {
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
  const satoshisPerByte = data.medium ?? data.fast ?? 20;
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
async function estimateEthereumFee(): Promise<number> {
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
  const gasPriceWei = data.gasPrice?.medium ?? data.gasPrice?.fast ?? data.medium ?? data.fast ?? 30000000000;
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