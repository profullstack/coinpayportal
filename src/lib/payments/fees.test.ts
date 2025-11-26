import { describe, it, expect } from 'vitest';
import { calculateFee, calculateMerchantAmount, calculatePlatformFee, FEE_PERCENTAGE } from './fees';

describe('Payment Fee Calculations', () => {
  describe('FEE_PERCENTAGE constant', () => {
    it('should be 0.5%', () => {
      expect(FEE_PERCENTAGE).toBe(0.005);
    });
  });

  describe('calculateFee', () => {
    it('should calculate 0.5% fee correctly', () => {
      const fee = calculateFee(100);
      expect(fee).toBe(0.5); // 100 * 0.005
    });

    it('should handle decimal amounts', () => {
      const fee = calculateFee(123.45);
      expect(fee).toBeCloseTo(0.61725, 6);
    });

    it('should handle very small amounts', () => {
      const fee = calculateFee(1);
      expect(fee).toBe(0.005);
    });

    it('should handle very large amounts', () => {
      const fee = calculateFee(1000000);
      expect(fee).toBe(5000); // 1M * 0.005
    });

    it('should handle crypto amounts with many decimals', () => {
      const fee = calculateFee(0.00123456);
      expect(fee).toBeCloseTo(0.00000617, 8);
    });

    it('should throw error for zero amount', () => {
      expect(() => calculateFee(0)).toThrow();
    });

    it('should throw error for negative amount', () => {
      expect(() => calculateFee(-100)).toThrow();
    });

    it('should round to 8 decimal places for crypto', () => {
      const fee = calculateFee(0.123456789);
      const feeStr = fee.toString();
      const decimals = feeStr.split('.')[1]?.length || 0;
      expect(decimals).toBeLessThanOrEqual(8);
    });
  });

  describe('calculateMerchantAmount', () => {
    it('should calculate merchant amount (99.5% of total)', () => {
      const merchantAmount = calculateMerchantAmount(100);
      expect(merchantAmount).toBe(99.5); // 100 - 0.5
    });

    it('should handle decimal amounts', () => {
      const merchantAmount = calculateMerchantAmount(123.45);
      expect(merchantAmount).toBeCloseTo(122.83275, 6);
    });

    it('should handle very small amounts', () => {
      const merchantAmount = calculateMerchantAmount(1);
      expect(merchantAmount).toBe(0.995);
    });

    it('should handle very large amounts', () => {
      const merchantAmount = calculateMerchantAmount(1000000);
      expect(merchantAmount).toBe(995000); // 1M - 5000
    });

    it('should throw error for zero amount', () => {
      expect(() => calculateMerchantAmount(0)).toThrow();
    });

    it('should throw error for negative amount', () => {
      expect(() => calculateMerchantAmount(-100)).toThrow();
    });

    it('should ensure merchant + fee = total', () => {
      const total = 100;
      const fee = calculateFee(total);
      const merchant = calculateMerchantAmount(total);
      
      expect(merchant + fee).toBeCloseTo(total, 10);
    });
  });

  describe('calculatePlatformFee', () => {
    it('should be alias for calculateFee', () => {
      const amount = 100;
      expect(calculatePlatformFee(amount)).toBe(calculateFee(amount));
    });

    it('should calculate platform fee correctly', () => {
      const platformFee = calculatePlatformFee(1000);
      expect(platformFee).toBe(5); // 1000 * 0.005
    });
  });

  describe('Integration: Fee calculations', () => {
    it('should split payment correctly', () => {
      const totalAmount = 1000;
      const platformFee = calculatePlatformFee(totalAmount);
      const merchantAmount = calculateMerchantAmount(totalAmount);
      
      expect(platformFee).toBe(5);
      expect(merchantAmount).toBe(995);
      expect(platformFee + merchantAmount).toBeCloseTo(totalAmount, 10);
    });

    it('should handle crypto payment split', () => {
      const totalCrypto = 0.5; // 0.5 ETH
      const platformFee = calculatePlatformFee(totalCrypto);
      const merchantAmount = calculateMerchantAmount(totalCrypto);
      
      expect(platformFee).toBeCloseTo(0.0025, 8);
      expect(merchantAmount).toBeCloseTo(0.4975, 8);
      expect(platformFee + merchantAmount).toBeCloseTo(totalCrypto, 10);
    });

    it('should handle very small crypto amounts', () => {
      const totalCrypto = 0.00001; // Very small amount
      const platformFee = calculatePlatformFee(totalCrypto);
      const merchantAmount = calculateMerchantAmount(totalCrypto);
      
      expect(platformFee).toBeGreaterThan(0);
      expect(merchantAmount).toBeGreaterThan(0);
      expect(platformFee + merchantAmount).toBeCloseTo(totalCrypto, 10);
    });

    it('should maintain precision for large fiat amounts', () => {
      const totalFiat = 999999.99;
      const platformFee = calculatePlatformFee(totalFiat);
      const merchantAmount = calculateMerchantAmount(totalFiat);
      
      expect(platformFee).toBeCloseTo(5000, 1);
      expect(merchantAmount).toBeCloseTo(995000, 1);
      expect(platformFee + merchantAmount).toBeCloseTo(totalFiat, 2);
    });
  });
});