/**
 * Network Fee Utilities for Payment Processing
 *
 * This module provides network fee estimation for cryptocurrency payments.
 * Fees are fetched dynamically from Tatum API and public gas APIs.
 */

import { getEstimatedNetworkFee as getDynamicFee, getStaticFees } from '../rates/fees';

// Static fees for chains with predictable fees (not fetched from API)
export const STATIC_NETWORK_FEES_USD = getStaticFees();

/**
 * Supported blockchain types
 */
export type Blockchain =
  | 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
  | 'DOGE' | 'XRP' | 'ADA' | 'BNB'
  | 'USDT' | 'USDC'
  | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

/**
 * Get estimated network fee for a blockchain in USD
 * Uses Tatum API for real-time estimates
 *
 * @param blockchain - The blockchain to estimate fees for
 * @returns Estimated fee in USD
 */
export async function getEstimatedNetworkFee(blockchain: Blockchain): Promise<number> {
  return getDynamicFee(blockchain);
}

/**
 * Synchronous version that returns static fees for low-fee chains
 * Only returns values for chains with predictable fees (BCH, DOGE, XRP, ADA, BNB)
 * For other chains, use the async version to get real-time fees
 *
 * @param blockchain - The blockchain to get static fee for
 * @returns Static fee in USD, or undefined if chain requires dynamic lookup
 */
export function getStaticNetworkFee(blockchain: Blockchain): number | undefined {
  const baseChain = blockchain.startsWith('USDC_')
    ? blockchain.replace('USDC_', '') as keyof typeof STATIC_NETWORK_FEES_USD
    : blockchain as keyof typeof STATIC_NETWORK_FEES_USD;
  return STATIC_NETWORK_FEES_USD[baseChain];
}