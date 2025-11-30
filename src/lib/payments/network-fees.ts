/**
 * Network Fee Utilities for Payment Processing
 * 
 * This module provides network fee estimation for cryptocurrency payments.
 * Fees are fetched dynamically from Tatum API when possible, with fallbacks
 * for reliability.
 */

import { getEstimatedNetworkFee as getDynamicFee, getFallbackFees } from '../rates/fees';

// Re-export the fallback fees for backward compatibility and display purposes
export const ESTIMATED_NETWORK_FEES_USD = getFallbackFees();

/**
 * Supported blockchain types
 */
export type Blockchain = 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL' | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

/**
 * Get estimated network fee for a blockchain in USD
 * Uses Tatum API for real-time estimates with fallback to static values
 * 
 * @param blockchain - The blockchain to estimate fees for
 * @returns Estimated fee in USD
 */
export async function getEstimatedNetworkFee(blockchain: Blockchain): Promise<number> {
  return getDynamicFee(blockchain);
}

/**
 * Synchronous version that returns fallback fees
 * Use this when you need a quick estimate without async
 * 
 * @param blockchain - The blockchain to get fallback fee for
 * @returns Fallback fee in USD
 */
export function getEstimatedNetworkFeeSync(blockchain: Blockchain): number {
  const baseChain = blockchain.startsWith('USDC_')
    ? blockchain.replace('USDC_', '')
    : blockchain;
  return ESTIMATED_NETWORK_FEES_USD[baseChain] || 0.01;
}