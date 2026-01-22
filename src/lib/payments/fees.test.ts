import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateFee,
  calculateMerchantAmount,
  calculatePlatformFee,
  FEE_PERCENTAGE,
  FEE_PERCENTAGE_FREE,
  FEE_PERCENTAGE_PAID,
  getFeePercentage,
  calculateTieredFee,
  calculateTieredMerchantAmount,
  splitTieredPayment,
  getTieredFeePercentageString,
} from './fees';
import {
  STATIC_NETWORK_FEES_USD,
  getStaticNetworkFee,
  type Blockchain
} from './network-fees';

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

  describe('Static Network Fees', () => {
    describe('STATIC_NETWORK_FEES_USD (for low-fee chains)', () => {
      it('should have fee estimates for chains with predictable fees', () => {
        expect(STATIC_NETWORK_FEES_USD).toHaveProperty('BCH');
        expect(STATIC_NETWORK_FEES_USD).toHaveProperty('DOGE');
        expect(STATIC_NETWORK_FEES_USD).toHaveProperty('XRP');
        expect(STATIC_NETWORK_FEES_USD).toHaveProperty('ADA');
        expect(STATIC_NETWORK_FEES_USD).toHaveProperty('BNB');
      });

      it('should NOT have fees for chains that use dynamic lookup', () => {
        // These chains should use real-time API estimation
        expect(STATIC_NETWORK_FEES_USD).not.toHaveProperty('BTC');
        expect(STATIC_NETWORK_FEES_USD).not.toHaveProperty('ETH');
        expect(STATIC_NETWORK_FEES_USD).not.toHaveProperty('POL');
        expect(STATIC_NETWORK_FEES_USD).not.toHaveProperty('SOL');
      });

      it('should have reasonable fee estimates', () => {
        // Bitcoin Cash: very low fees
        expect(STATIC_NETWORK_FEES_USD['BCH']).toBe(0.01);

        // Dogecoin: low fees
        expect(STATIC_NETWORK_FEES_USD['DOGE']).toBe(0.05);

        // XRP: very low fees
        expect(STATIC_NETWORK_FEES_USD['XRP']).toBe(0.001);

        // Cardano: moderate fees
        expect(STATIC_NETWORK_FEES_USD['ADA']).toBe(0.20);

        // BNB Smart Chain: low fees
        expect(STATIC_NETWORK_FEES_USD['BNB']).toBe(0.10);
      });

      it('should have all fees as positive numbers', () => {
        for (const [chain, fee] of Object.entries(STATIC_NETWORK_FEES_USD)) {
          expect(fee).toBeGreaterThan(0);
          expect(typeof fee).toBe('number');
        }
      });
    });

    describe('getStaticNetworkFee (synchronous for low-fee chains)', () => {
      it('should return correct fee for BCH', () => {
        expect(getStaticNetworkFee('BCH')).toBe(0.01);
      });

      it('should return correct fee for DOGE', () => {
        expect(getStaticNetworkFee('DOGE' as Blockchain)).toBe(0.05);
      });

      it('should return correct fee for XRP', () => {
        expect(getStaticNetworkFee('XRP' as Blockchain)).toBe(0.001);
      });

      it('should return correct fee for ADA', () => {
        expect(getStaticNetworkFee('ADA' as Blockchain)).toBe(0.20);
      });

      it('should return correct fee for BNB', () => {
        expect(getStaticNetworkFee('BNB' as Blockchain)).toBe(0.10);
      });

      it('should return undefined for chains requiring dynamic lookup', () => {
        // These chains need real-time API estimation
        expect(getStaticNetworkFee('BTC')).toBeUndefined();
        expect(getStaticNetworkFee('ETH')).toBeUndefined();
        expect(getStaticNetworkFee('POL')).toBeUndefined();
        expect(getStaticNetworkFee('SOL')).toBeUndefined();
      });

      it('should handle USDC variants by using base chain', () => {
        // USDC on BCH would use BCH static fee (if supported)
        // But ETH, POL, SOL don't have static fees
        expect(getStaticNetworkFee('USDC_ETH' as Blockchain)).toBeUndefined();
        expect(getStaticNetworkFee('USDC_POL' as Blockchain)).toBeUndefined();
        expect(getStaticNetworkFee('USDC_SOL' as Blockchain)).toBeUndefined();
      });
    });
  });

  describe('Tiered Commission Rates', () => {
    describe('Fee percentage constants', () => {
      it('should have 1% fee for free tier (Starter)', () => {
        expect(FEE_PERCENTAGE_FREE).toBe(0.01);
      });

      it('should have 0.5% fee for paid tier (Professional)', () => {
        expect(FEE_PERCENTAGE_PAID).toBe(0.005);
      });

      it('should have legacy constant equal to paid tier for backward compatibility', () => {
        expect(FEE_PERCENTAGE).toBe(FEE_PERCENTAGE_PAID);
      });

      it('should have free tier fee be exactly 2x paid tier fee', () => {
        expect(FEE_PERCENTAGE_FREE).toBe(FEE_PERCENTAGE_PAID * 2);
      });
    });

    describe('getFeePercentage', () => {
      it('should return 0.5% for paid tier', () => {
        expect(getFeePercentage(true)).toBe(0.005);
      });

      it('should return 1% for free tier', () => {
        expect(getFeePercentage(false)).toBe(0.01);
      });
    });

    describe('calculateTieredFee', () => {
      it('should calculate 0.5% fee for paid tier', () => {
        const fee = calculateTieredFee(100, true);
        expect(fee).toBe(0.5); // 100 * 0.005
      });

      it('should calculate 1% fee for free tier', () => {
        const fee = calculateTieredFee(100, false);
        expect(fee).toBe(1); // 100 * 0.01
      });

      it('should handle decimal amounts for paid tier', () => {
        const fee = calculateTieredFee(123.45, true);
        expect(fee).toBeCloseTo(0.61725, 6);
      });

      it('should handle decimal amounts for free tier', () => {
        const fee = calculateTieredFee(123.45, false);
        expect(fee).toBeCloseTo(1.2345, 6);
      });

      it('should handle crypto amounts with paid tier', () => {
        const fee = calculateTieredFee(0.5, true); // 0.5 ETH
        expect(fee).toBeCloseTo(0.0025, 8);
      });

      it('should handle crypto amounts with free tier', () => {
        const fee = calculateTieredFee(0.5, false); // 0.5 ETH
        expect(fee).toBeCloseTo(0.005, 8);
      });

      it('should throw error for zero amount', () => {
        expect(() => calculateTieredFee(0, true)).toThrow();
        expect(() => calculateTieredFee(0, false)).toThrow();
      });

      it('should throw error for negative amount', () => {
        expect(() => calculateTieredFee(-100, true)).toThrow();
        expect(() => calculateTieredFee(-100, false)).toThrow();
      });
    });

    describe('calculateTieredMerchantAmount', () => {
      it('should calculate 99.5% for paid tier (Professional)', () => {
        const merchantAmount = calculateTieredMerchantAmount(100, true);
        expect(merchantAmount).toBe(99.5);
      });

      it('should calculate 99% for free tier (Starter)', () => {
        const merchantAmount = calculateTieredMerchantAmount(100, false);
        expect(merchantAmount).toBe(99);
      });

      it('should ensure merchant + fee = total for paid tier', () => {
        const total = 100;
        const fee = calculateTieredFee(total, true);
        const merchant = calculateTieredMerchantAmount(total, true);
        expect(merchant + fee).toBeCloseTo(total, 10);
      });

      it('should ensure merchant + fee = total for free tier', () => {
        const total = 100;
        const fee = calculateTieredFee(total, false);
        const merchant = calculateTieredMerchantAmount(total, false);
        expect(merchant + fee).toBeCloseTo(total, 10);
      });
    });

    describe('splitTieredPayment', () => {
      it('should return correct split for paid tier', () => {
        const result = splitTieredPayment(100, true);
        expect(result.merchantAmount).toBe(99.5);
        expect(result.platformFee).toBe(0.5);
        expect(result.total).toBe(100);
        expect(result.feePercentage).toBe(0.005);
      });

      it('should return correct split for free tier', () => {
        const result = splitTieredPayment(100, false);
        expect(result.merchantAmount).toBe(99);
        expect(result.platformFee).toBe(1);
        expect(result.total).toBe(100);
        expect(result.feePercentage).toBe(0.01);
      });

      it('should handle crypto amounts for paid tier', () => {
        const result = splitTieredPayment(0.5, true); // 0.5 ETH
        expect(result.merchantAmount).toBeCloseTo(0.4975, 8);
        expect(result.platformFee).toBeCloseTo(0.0025, 8);
        expect(result.total).toBe(0.5);
      });

      it('should handle crypto amounts for free tier', () => {
        const result = splitTieredPayment(0.5, false); // 0.5 ETH
        expect(result.merchantAmount).toBeCloseTo(0.495, 8);
        expect(result.platformFee).toBeCloseTo(0.005, 8);
        expect(result.total).toBe(0.5);
      });

      it('should ensure parts sum to total for any amount', () => {
        const amounts = [1, 10, 100, 1000, 0.00123, 12345.67];
        for (const amount of amounts) {
          for (const isPaid of [true, false]) {
            const result = splitTieredPayment(amount, isPaid);
            expect(result.merchantAmount + result.platformFee).toBeCloseTo(result.total, 8);
          }
        }
      });
    });

    describe('getTieredFeePercentageString', () => {
      it('should return "0.5%" for paid tier', () => {
        expect(getTieredFeePercentageString(true)).toBe('0.5%');
      });

      it('should return "1%" for free tier', () => {
        expect(getTieredFeePercentageString(false)).toBe('1%');
      });
    });

    describe('Comparison: Paid vs Free tier savings', () => {
      it('should show 50% savings on paid tier', () => {
        const amount = 1000;
        const freeTierFee = calculateTieredFee(amount, false);
        const paidTierFee = calculateTieredFee(amount, true);

        expect(paidTierFee).toBe(freeTierFee / 2);
        expect(paidTierFee).toBe(5);
        expect(freeTierFee).toBe(10);
      });

      it('should give merchant 0.5% more on paid tier', () => {
        const amount = 10000;
        const freeMerchant = calculateTieredMerchantAmount(amount, false);
        const paidMerchant = calculateTieredMerchantAmount(amount, true);

        expect(paidMerchant - freeMerchant).toBe(50); // 0.5% of 10000
        expect(paidMerchant).toBe(9950); // 99.5%
        expect(freeMerchant).toBe(9900); // 99%
      });
    });
  });
});
