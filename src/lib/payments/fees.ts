/**
 * Payment Fee Calculations
 * Platform transaction fee: 0.5% of payment amount
 * Merchant receives: 99.5% of payment amount
 */

/**
 * Platform fee percentage (0.5%)
 * Merchant receives 99.5% of the payment
 */
export const FEE_PERCENTAGE = 0.005;

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
 * Calculate platform fee (0.5% of amount)
 * @param amount - Total payment amount
 * @returns Platform fee amount
 */
export function calculateFee(amount: number): number {
  validateAmount(amount);
  
  const fee = amount * FEE_PERCENTAGE;
  
  // Round to 8 decimal places for crypto precision
  return roundTo(fee, CRYPTO_PRECISION);
}

/**
 * Calculate merchant amount (99.5% of total)
 * @param amount - Total payment amount
 * @returns Amount merchant receives
 */
export function calculateMerchantAmount(amount: number): number {
  validateAmount(amount);
  
  const fee = calculateFee(amount);
  const merchantAmount = amount - fee;
  
  // Round to 8 decimal places for crypto precision
  return roundTo(merchantAmount, CRYPTO_PRECISION);
}

/**
 * Alias for calculateFee (for clarity in code)
 * @param amount - Total payment amount
 * @returns Platform fee amount
 */
export function calculatePlatformFee(amount: number): number {
  return calculateFee(amount);
}

/**
 * Split payment amount into merchant and platform portions
 * @param amount - Total payment amount
 * @returns Object with merchant and platform amounts
 */
export function splitPayment(amount: number): {
  merchantAmount: number;
  platformFee: number;
  total: number;
} {
  validateAmount(amount);
  
  const platformFee = calculateFee(amount);
  const merchantAmount = calculateMerchantAmount(amount);
  
  return {
    merchantAmount,
    platformFee,
    total: amount,
  };
}

/**
 * Calculate fee percentage as human-readable string
 * @returns Fee percentage string (e.g., "0.25%")
 */
export function getFeePercentageString(): string {
  return `${FEE_PERCENTAGE * 100}%`;
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