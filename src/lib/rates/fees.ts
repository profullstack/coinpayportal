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

const TATUM_API_BASE = 'https://api.tatum.io';

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
 * Uses Tatum's recommended fee endpoint
 */
async function estimateBitcoinFee(): Promise<number> {
  try {
    const apiKey = getApiKey();
    
    // Get recommended fee in satoshis per byte
    const response = await fetch(`${TATUM_API_BASE}/v3/bitcoin/info`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Tatum API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Average transaction size is ~250 bytes
    // Fee = satoshis_per_byte * 250 bytes
    const satoshisPerByte = data.feePerByte || 20; // Default to 20 sat/byte
    const avgTxSize = 250;
    const feeInSatoshis = satoshisPerByte * avgTxSize;
    const feeInBtc = feeInSatoshis / 100000000;
    
    // Convert to USD
    const btcPrice = await getExchangeRate('BTC', 'USD');
    return feeInBtc * btcPrice;
  } catch (error) {
    console.warn('[Fee] Bitcoin fee estimation failed, using fallback:', error);
    return FALLBACK_FEES_USD['BTC'];
  }
}

/**
 * Estimate Ethereum transaction fee in USD
 * Uses Tatum's gas price endpoint
 */
async function estimateEthereumFee(): Promise<number> {
  try {
    const apiKey = getApiKey();
    
    // Get current gas price
    const response = await fetch(`${TATUM_API_BASE}/v3/ethereum/gas`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Tatum API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Gas price is in Gwei, standard transfer uses 21000 gas
    // For token transfers, use ~65000 gas
    const gasPriceGwei = parseFloat(data.gasPrice || data.fast || '30');
    const gasLimit = 65000; // Use higher estimate for token transfers
    const feeInGwei = gasPriceGwei * gasLimit;
    const feeInEth = feeInGwei / 1000000000;
    
    // Convert to USD
    const ethPrice = await getExchangeRate('ETH', 'USD');
    return feeInEth * ethPrice;
  } catch (error) {
    console.warn('[Fee] Ethereum fee estimation failed, using fallback:', error);
    return FALLBACK_FEES_USD['ETH'];
  }
}

/**
 * Estimate Polygon transaction fee in USD
 * Uses Tatum's gas price endpoint for Polygon
 */
async function estimatePolygonFee(): Promise<number> {
  try {
    const apiKey = getApiKey();
    
    // Get current gas price for Polygon
    const response = await fetch(`${TATUM_API_BASE}/v3/polygon/gas`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Tatum API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Gas price is in Gwei
    const gasPriceGwei = parseFloat(data.gasPrice || data.fast || '100');
    const gasLimit = 65000;
    const feeInGwei = gasPriceGwei * gasLimit;
    const feeInMatic = feeInGwei / 1000000000;
    
    // Convert to USD (POL is the new symbol for Polygon's native token)
    const polPrice = await getExchangeRate('POL', 'USD');
    return feeInMatic * polPrice;
  } catch (error) {
    console.warn('[Fee] Polygon fee estimation failed, using fallback:', error);
    return FALLBACK_FEES_USD['POL'];
  }
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
    console.warn(`[Fee] Failed to estimate ${baseChain} fee, using fallback:`, error);
    return FALLBACK_FEES_USD[baseChain] || 0.10;
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