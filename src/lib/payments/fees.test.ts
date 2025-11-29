import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateFee, calculateMerchantAmount, calculatePlatformFee, FEE_PERCENTAGE } from './fees';
import {
  ESTIMATED_NETWORK_FEES_USD,
  getEstimatedNetworkFeeSync,
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

  describe('Network Fee Estimates', () => {
    describe('ESTIMATED_NETWORK_FEES_USD (fallback values)', () => {
      it('should have fee estimates for all supported blockchains', () => {
        expect(ESTIMATED_NETWORK_FEES_USD).toHaveProperty('BTC');
        expect(ESTIMATED_NETWORK_FEES_USD).toHaveProperty('BCH');
        expect(ESTIMATED_NETWORK_FEES_USD).toHaveProperty('ETH');
        expect(ESTIMATED_NETWORK_FEES_USD).toHaveProperty('MATIC');
        expect(ESTIMATED_NETWORK_FEES_USD).toHaveProperty('SOL');
      });

      it('should have reasonable fee estimates', () => {
        // Bitcoin: $0.50-3.00 range, estimate $2.00
        expect(ESTIMATED_NETWORK_FEES_USD['BTC']).toBe(2.00);
        
        // Bitcoin Cash: very low fees
        expect(ESTIMATED_NETWORK_FEES_USD['BCH']).toBe(0.01);
        
        // Ethereum: $0.50-5.00 range, estimate $3.00
        expect(ESTIMATED_NETWORK_FEES_USD['ETH']).toBe(3.00);
        
        // Polygon: very low fees
        expect(ESTIMATED_NETWORK_FEES_USD['MATIC']).toBe(0.01);
        
        // Solana: extremely low fees
        expect(ESTIMATED_NETWORK_FEES_USD['SOL']).toBe(0.001);
      });

      it('should have all fees as positive numbers', () => {
        for (const [chain, fee] of Object.entries(ESTIMATED_NETWORK_FEES_USD)) {
          expect(fee).toBeGreaterThan(0);
          expect(typeof fee).toBe('number');
        }
      });
    });

    describe('getEstimatedNetworkFeeSync (synchronous fallback)', () => {
      it('should return correct fee for BTC', () => {
        expect(getEstimatedNetworkFeeSync('BTC')).toBe(2.00);
      });

      it('should return correct fee for ETH', () => {
        expect(getEstimatedNetworkFeeSync('ETH')).toBe(3.00);
      });

      it('should return correct fee for MATIC', () => {
        expect(getEstimatedNetworkFeeSync('MATIC')).toBe(0.01);
      });

      it('should return correct fee for SOL', () => {
        expect(getEstimatedNetworkFeeSync('SOL')).toBe(0.001);
      });

      it('should return correct fee for BCH', () => {
        expect(getEstimatedNetworkFeeSync('BCH')).toBe(0.01);
      });

      it('should handle USDC variants by using base chain fee', () => {
        // USDC on Ethereum should use ETH fee
        expect(getEstimatedNetworkFeeSync('USDC_ETH' as Blockchain)).toBe(3.00);
        
        // USDC on Polygon should use MATIC fee
        expect(getEstimatedNetworkFeeSync('USDC_MATIC' as Blockchain)).toBe(0.01);
        
        // USDC on Solana should use SOL fee
        expect(getEstimatedNetworkFeeSync('USDC_SOL' as Blockchain)).toBe(0.001);
      });

      it('should return default fee for unknown blockchain', () => {
        expect(getEstimatedNetworkFeeSync('UNKNOWN' as Blockchain)).toBe(0.01);
      });
    });

    describe('Integration: Total payment with network fees', () => {
      it('should calculate total payment amount including network fee', () => {
        const baseAmount = 100; // $100 payment
        const blockchain: Blockchain = 'ETH';
        const networkFee = getEstimatedNetworkFeeSync(blockchain);
        const totalAmount = baseAmount + networkFee;
        
        expect(totalAmount).toBe(103); // $100 + $3 ETH fee
      });

      it('should calculate total for Solana with minimal fee impact', () => {
        const baseAmount = 10; // $10 payment
        const blockchain: Blockchain = 'SOL';
        const networkFee = getEstimatedNetworkFeeSync(blockchain);
        const totalAmount = baseAmount + networkFee;
        
        expect(totalAmount).toBeCloseTo(10.001, 3); // $10 + $0.001 SOL fee
      });

      it('should calculate total for Bitcoin with higher fee', () => {
        const baseAmount = 50; // $50 payment
        const blockchain: Blockchain = 'BTC';
        const networkFee = getEstimatedNetworkFeeSync(blockchain);
        const totalAmount = baseAmount + networkFee;
        
        expect(totalAmount).toBe(52); // $50 + $2 BTC fee
      });

      it('should ensure merchant receives base amount after forwarding', () => {
        const baseAmount = 100;
        const blockchain: Blockchain = 'ETH';
        const networkFee = getEstimatedNetworkFeeSync(blockchain);
        const totalPaid = baseAmount + networkFee; // Customer pays this
        
        // After forwarding, network fee is deducted
        const afterNetworkFee = totalPaid - networkFee;
        expect(afterNetworkFee).toBe(baseAmount);
        
        // Then platform fee is deducted
        const platformFee = calculatePlatformFee(afterNetworkFee);
        const merchantReceives = calculateMerchantAmount(afterNetworkFee);
        
        expect(platformFee).toBe(0.5); // 0.5% of $100
        expect(merchantReceives).toBe(99.5); // $100 - $0.50
      });

      it('should handle small payments with proportionally larger fees', () => {
        const baseAmount = 5; // $5 payment
        const blockchain: Blockchain = 'ETH';
        const networkFee = getEstimatedNetworkFeeSync(blockchain);
        const totalPaid = baseAmount + networkFee;
        
        // For small payments, network fee is a larger percentage
        const feePercentage = (networkFee / baseAmount) * 100;
        expect(feePercentage).toBe(60); // $3 is 60% of $5
        
        expect(totalPaid).toBe(8); // $5 + $3
      });
    });
  });
});