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
 * Default platform fee when no tier is known.
 *
 * Deliberately the FREE rate. A caller that has not resolved the merchant's
 * tier must not be handed the discounted professional rate by default — that
 * fails open in the platform's disfavour and was the shape of the 50% revenue
 * leak. Resolve the tier and use getFeePercentage(isPaidTier) instead.
 *
 * @deprecated Use getFeePercentage(isPaidTier) instead
 */
export const FEE_PERCENTAGE = FEE_PERCENTAGE_FREE;

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
// NOTE ON REMOVED LEGACY HELPERS
// ============================================
//
// calculateFee / calculateMerchantAmount / calculatePlatformFee / splitPayment
// / getFeePercentageString used to exist here and passed `isPaidTier: true`
// unconditionally, so every caller that reached for the short name silently
// charged a free-tier merchant the 0.5% professional rate instead of 1% — half
// the commission the platform is owed. They had no production callers left, so
// rather than "fixing the default" (which would still leave a name that hides
// the tier) they are removed outright. Use the tiered functions above and pass
// the merchant's real tier from isPaidTier()/isBusinessPaidTier().

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
