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
import { fetchWithRetry, RetryError } from '../utils/retry';

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
 * Fallback fees in USD when API is unavailable
 * These are conservative estimates to ensure transactions go through
 */
const FALLBACK_FEES_USD: Record<string, number> = {
  'BTC': 2.00,    // Bitcoin: ~$0.50-3.00
  'BCH': 0.01,    // Bitcoin Cash: very low fees
  'ETH': 3.00,    // Ethereum: ~$0.50-5.00
  'POL': 0.01,    // Polygon: ~$0.001-0.01
  'SOL': 0.001,   // Solana: ~$0.00025
  'DOGE': 0.05,   // Dogecoin: ~$0.01-0.10
  'XRP': 0.001,   // Ripple: very low fees
  'ADA': 0.20,    // Cardano: ~$0.15-0.30
  'BNB': 0.10,    // Binance Smart Chain: ~$0.05-0.20
  'USDT': 3.00,   // USDT (ERC-20): same as ETH
  'USDC': 3.00,   // USDC (ERC-20): same as ETH
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
 * Uses Tatum's recommended fee endpoint with retry logic
 */
async function estimateBitcoinFee(): Promise<number> {
  const apiKey = getApiKey();
  
  // Get recommended fee in satoshis per byte with retry
  const response = await fetchWithRetry(
    `${TATUM_API_BASE}/v3/bitcoin/info`,
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
    throw new Error(`Tatum API error: ${response.status}`);
  }

  const data = await response.json() as { feePerByte?: number };
  
  // Average transaction size is ~250 bytes
  // Fee = satoshis_per_byte * 250 bytes
  const satoshisPerByte = data.feePerByte ?? 20; // Default to 20 sat/byte
  const avgTxSize = 250;
  const feeInSatoshis = satoshisPerByte * avgTxSize;
  const feeInBtc = feeInSatoshis / 100000000;
  
  // Convert to USD
  const btcPrice = await getExchangeRate('BTC', 'USD');
  return feeInBtc * btcPrice;
}

/**
 * Estimate Ethereum transaction fee in USD
 * Uses Tatum's gas price endpoint with retry logic
 */
async function estimateEthereumFee(): Promise<number> {
  const apiKey = getApiKey();
  
  // Get current gas price with retry
  const response = await fetchWithRetry(
    `${TATUM_API_BASE}/v3/ethereum/gas`,
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
    throw new Error(`Tatum API error: ${response.status}`);
  }

  const data = await response.json() as { gasPrice?: string; fast?: string };
  
  // Gas price is in Gwei, standard transfer uses 21000 gas
  // For token transfers, use ~65000 gas
  const gasPriceGwei = parseFloat(data.gasPrice ?? data.fast ?? '30');
  const gasLimit = 65000; // Use higher estimate for token transfers
  const feeInGwei = gasPriceGwei * gasLimit;
  const feeInEth = feeInGwei / 1000000000;
  
  // Convert to USD
  const ethPrice = await getExchangeRate('ETH', 'USD');
  return feeInEth * ethPrice;
}

/**
 * Estimate Polygon transaction fee in USD
 * Uses Tatum's gas price endpoint for Polygon with retry logic
 */
async function estimatePolygonFee(): Promise<number> {
  const apiKey = getApiKey();
  
  // Get current gas price for Polygon with retry
  const response = await fetchWithRetry(
    `${TATUM_API_BASE}/v3/polygon/gas`,
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
    throw new Error(`Tatum API error: ${response.status}`);
  }

  const data = await response.json() as { gasPrice?: string; fast?: string };
  
  // Gas price is in Gwei
  const gasPriceGwei = parseFloat(data.gasPrice ?? data.fast ?? '100');
  const gasLimit = 65000;
  const feeInGwei = gasPriceGwei * gasLimit;
  const feeInMatic = feeInGwei / 1000000000;
  
  // Convert to USD (POL is the new symbol for Polygon's native token)
  const polPrice = await getExchangeRate('POL', 'USD');
  return feeInMatic * polPrice;
}

/**
 * Estimate Solana transaction fee in USD
 * Solana has very predictable fees
 */
async function estimateSolanaFee(): Promise<number> {
  try {
    // Solana fees are very predictable: 5000 lamports per signature
    // Most transactions have 1-2 signatures
    const lamportsPerSignature = 5000;
    const signatures = 2; // Conservative estimate
    const feeInLamports = lamportsPerSignature * signatures;
    const feeInSol = feeInLamports / 1000000000;
    
    // Convert to USD
    const solPrice = await getExchangeRate('SOL', 'USD');
    return feeInSol * solPrice;
  } catch (error) {
    console.warn('[Fee] Solana fee estimation failed, using fallback:', error);
    return FALLBACK_FEES_USD['SOL'];
  }
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
  
  try {
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
        // BCH has very low fees, use static estimate
        fee = FALLBACK_FEES_USD['BCH'];
        break;
      case 'DOGE':
        // Dogecoin has low fees, use static estimate
        fee = FALLBACK_FEES_USD['DOGE'];
        break;
      case 'XRP':
        // XRP has very low fees, use static estimate
        fee = FALLBACK_FEES_USD['XRP'];
        break;
      case 'ADA':
        // Cardano has moderate fees, use static estimate
        fee = FALLBACK_FEES_USD['ADA'];
        break;
      case 'BNB':
        // BNB Smart Chain has low fees, use static estimate
        fee = FALLBACK_FEES_USD['BNB'];
        break;
      case 'USDT':
      case 'USDC':
        // Stablecoins on Ethereum, use ETH fee estimate
        fee = await estimateEthereumFee();
        break;
      default:
        // Unknown blockchain, use conservative estimate
        fee = 0.10;
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
  } catch (error) {
    if (error instanceof RetryError) {
      console.warn(
        `[Fee] ${baseChain} fee estimation failed after ${error.attempts} attempts ` +
        `(last status: ${error.lastStatus ?? 'N/A'}), using fallback: $${FALLBACK_FEES_USD[baseChain] ?? 0.10}`
      );
    } else {
      console.warn(`[Fee] Failed to estimate ${baseChain} fee, using fallback:`, error);
    }
    return FALLBACK_FEES_USD[baseChain] ?? 0.10;
  }
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
 * Get fallback fees (for display purposes when API is unavailable)
 */
export function getFallbackFees(): Record<string, number> {
  return { ...FALLBACK_FEES_USD };
}