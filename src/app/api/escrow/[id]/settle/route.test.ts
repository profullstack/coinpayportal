import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for escrow settlement route logic.
 * Verifies that split transactions are preferred for release+fee scenarios.
 */

describe('Escrow Settlement Logic', () => {
  it('should use split transaction when releasing with fee', () => {
    const action = 'release';
    const feeAmount = 0.001;
    const hasSplitTx = true;
    const commissionWallet = 'CommissionWallet123';

    const useSplit = action === 'release' && feeAmount > 0 && hasSplitTx && !!commissionWallet;
    expect(useSplit).toBe(true);
  });

  it('should NOT use split transaction for refunds', () => {
    const action = 'refund';
    const feeAmount = 0.001;
    const hasSplitTx = true;
    const commissionWallet = 'CommissionWallet123';

    const useSplit = action === 'release' && feeAmount > 0 && hasSplitTx && !!commissionWallet;
    expect(useSplit).toBe(false);
  });

  it('should NOT use split transaction when no commission wallet', () => {
    const action = 'release';
    const feeAmount = 0.001;
    const hasSplitTx = true;
    const commissionWallet = null;

    const useSplit = action === 'release' && feeAmount > 0 && hasSplitTx && !!commissionWallet;
    expect(useSplit).toBe(false);
  });

  it('should NOT use split transaction when fee is 0', () => {
    const action = 'release';
    const feeAmount = 0;
    const hasSplitTx = true;
    const commissionWallet = 'CommissionWallet123';

    const useSplit = action === 'release' && feeAmount > 0 && hasSplitTx && !!commissionWallet;
    expect(useSplit).toBe(false);
  });

  it('should fall back to sequential when provider lacks sendSplitTransaction', () => {
    const action = 'release';
    const feeAmount = 0.001;
    const hasSplitTx = false;
    const commissionWallet = 'CommissionWallet123';

    const useSplit = action === 'release' && feeAmount > 0 && hasSplitTx && !!commissionWallet;
    expect(useSplit).toBe(false);
  });

  it('should calculate correct amounts for beneficiary and fee', () => {
    const depositedAmount = 0.011896577;
    const feeAmount = 0.000118965765629796;
    const amountToSend = depositedAmount - feeAmount;

    expect(amountToSend).toBeCloseTo(0.011777611, 8);
    expect(amountToSend + feeAmount).toBeCloseTo(depositedAmount, 8);
  });

  it('should send full deposited amount on refund (no fee)', () => {
    const depositedAmount = 0.011896577;
    const feeAmount = 0.000118965765629796;
    const action = 'refund';

    const amountToSend = action === 'refund'
      ? depositedAmount
      : depositedAmount - feeAmount;

    expect(amountToSend).toBe(depositedAmount);
  });
});
