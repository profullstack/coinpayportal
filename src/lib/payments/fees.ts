/**
 * Payment Fee Calculations
 *
 * Tiered Commission Structure:
 * - Free tier (starter): 1% platform fee, merchant receives 99%
 * - Paid tier (professional): 0.5% platform fee, merchant receives 99.5%
 */

/**
 * Platform fee percentages by tier
 * Free tier pays 2x the commission of paid tier
 */
export const FEE_PERCENTAGE_FREE = 0.01;   // 1% for free tier (starter)
export const FEE_PERCENTAGE_PAID = 0.005;  // 0.5% for paid tier (professional)

/**
 * Default fee percentage (legacy - use tiered functions for new code)
 * @deprecated Use getFeePercentage(isPaidTier) instead
 */
export const FEE_PERCENTAGE = FEE_PERCENTAGE_PAID;

/**
 * Subscription tier type
 */
export type SubscriptionTier = 'free' | 'paid';

/**
 * Precision for crypto amounts (8 decimal places)
 */
const CRYPTO_PRECISION = 8;

/**
 * Precision for fiat amounts (2 decimal places)
 */
const FIAT_PRECISION = 2;

/**
 * Round to specified decimal places
 */
function roundTo(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Validate amount is positive
 */
function validateAmount(amount: number): void {
  if (amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
  if (!isFinite(amount)) {
    throw new Error('Amount must be a finite number');
  }
}

/**
 * Get the fee percentage based on subscription tier
 * @param isPaidTier - Whether merchant has a paid subscription (professional plan)
 * @returns Fee percentage (0.01 for free, 0.005 for paid)
 */
export function getFeePercentage(isPaidTier: boolean): number {
  return isPaidTier ? FEE_PERCENTAGE_PAID : FEE_PERCENTAGE_FREE;
}

/**
 * Calculate platform fee based on subscription tier
 * @param amount - Total payment amount
 * @param isPaidTier - Whether merchant has a paid subscription
 * @returns Platform fee amount
 */
export function calculateTieredFee(amount: number, isPaidTier: boolean): number {
  validateAmount(amount);

  const feePercentage = getFeePercentage(isPaidTier);
  const fee = amount * feePercentage;

  // Round to 8 decimal places for crypto precision
  return roundTo(fee, CRYPTO_PRECISION);
}

/**
 * Calculate merchant amount based on subscription tier
 * @param amount - Total payment amount
 * @param isPaidTier - Whether merchant has a paid subscription
 * @returns Amount merchant receives
 */
export function calculateTieredMerchantAmount(amount: number, isPaidTier: boolean): number {
  validateAmount(amount);

  const fee = calculateTieredFee(amount, isPaidTier);
  const merchantAmount = amount - fee;

  // Round to 8 decimal places for crypto precision
  return roundTo(merchantAmount, CRYPTO_PRECISION);
}

/**
 * Split payment amount into merchant and platform portions based on tier
 * @param amount - Total payment amount
 * @param isPaidTier - Whether merchant has a paid subscription
 * @returns Object with merchant and platform amounts
 */
export function splitTieredPayment(amount: number, isPaidTier: boolean): {
  merchantAmount: number;
  platformFee: number;
  total: number;
  feePercentage: number;
} {
  validateAmount(amount);

  const feePercentage = getFeePercentage(isPaidTier);
  const platformFee = calculateTieredFee(amount, isPaidTier);
  const merchantAmount = calculateTieredMerchantAmount(amount, isPaidTier);

  return {
    merchantAmount,
    platformFee,
    total: amount,
    feePercentage,
  };
}

/**
 * Get fee percentage as human-readable string based on tier
 * @param isPaidTier - Whether merchant has a paid subscription
 * @returns Fee percentage string (e.g., "0.5%" or "1%")
 */
export function getTieredFeePercentageString(isPaidTier: boolean): string {
  const percentage = getFeePercentage(isPaidTier);
  return `${percentage * 100}%`;
}

// ============================================
// Legacy functions (for backward compatibility)
// These use the paid tier rate by default
// ============================================

/**
 * Calculate platform fee (uses paid tier rate for backward compatibility)
 * @param amount - Total payment amount
 * @returns Platform fee amount
 * @deprecated Use calculateTieredFee(amount, isPaidTier) instead
 */
export function calculateFee(amount: number): number {
  return calculateTieredFee(amount, true);
}

/**
 * Calculate merchant amount (uses paid tier rate for backward compatibility)
 * @param amount - Total payment amount
 * @returns Amount merchant receives
 * @deprecated Use calculateTieredMerchantAmount(amount, isPaidTier) instead
 */
export function calculateMerchantAmount(amount: number): number {
  return calculateTieredMerchantAmount(amount, true);
}

/**
 * Alias for calculateFee (for clarity in code)
 * @param amount - Total payment amount
 * @returns Platform fee amount
 * @deprecated Use calculateTieredFee(amount, isPaidTier) instead
 */
export function calculatePlatformFee(amount: number): number {
  return calculateFee(amount);
}

/**
 * Split payment amount into merchant and platform portions
 * Uses paid tier rate for backward compatibility
 * @param amount - Total payment amount
 * @returns Object with merchant and platform amounts
 * @deprecated Use splitTieredPayment(amount, isPaidTier) instead
 */
export function splitPayment(amount: number): {
  merchantAmount: number;
  platformFee: number;
  total: number;
} {
  const result = splitTieredPayment(amount, true);
  return {
    merchantAmount: result.merchantAmount,
    platformFee: result.platformFee,
    total: result.total,
  };
}

/**
 * Calculate fee percentage as human-readable string
 * Returns paid tier rate for backward compatibility
 * @returns Fee percentage string (e.g., "0.5%")
 * @deprecated Use getTieredFeePercentageString(isPaidTier) instead
 */
export function getFeePercentageString(): string {
  return getTieredFeePercentageString(true);
}

/**
 * Validate that split amounts equal total
 * @param merchantAmount - Merchant portion
 * @param platformFee - Platform fee
 * @param total - Total amount
 * @returns True if valid, throws error otherwise
 */
export function validateSplit(
  merchantAmount: number,
  platformFee: number,
  total: number
): boolean {
  const sum = merchantAmount + platformFee;
  const difference = Math.abs(sum - total);

  // Allow for small floating point errors (less than 0.00000001)
  if (difference > 0.00000001) {
    throw new Error(
      `Invalid split: merchant (${merchantAmount}) + fee (${platformFee}) != total (${total})`
    );
  }

  return true;
}
