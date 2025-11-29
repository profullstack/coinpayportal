import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEstimatedNetworkFee, getEstimatedNetworkFees, clearFeeCache, getFallbackFees } from './fees';

describe('Tatum Fee Estimation Service', () => {
  beforeEach(() => {
    clearFeeCache();
  });

  describe('getFallbackFees', () => {
    it('should return fallback fees for all supported blockchains', () => {
      const fees = getFallbackFees();
      
      expect(fees).toHaveProperty('BTC');
      expect(fees).toHaveProperty('BCH');
      expect(fees).toHaveProperty('ETH');
      expect(fees).toHaveProperty('MATIC');
      expect(fees).toHaveProperty('SOL');
    });

    it('should return reasonable fallback values', () => {
      const fees = getFallbackFees();
      
      expect(fees['BTC']).toBe(2.00);
      expect(fees['BCH']).toBe(0.01);
      expect(fees['ETH']).toBe(3.00);
      expect(fees['MATIC']).toBe(0.01);
      expect(fees['SOL']).toBe(0.001);
    });

    it('should return a copy, not the original object', () => {
      const fees1 = getFallbackFees();
      const fees2 = getFallbackFees();
      
      fees1['BTC'] = 999;
      expect(fees2['BTC']).toBe(2.00);
    });
  });

  describe('getEstimatedNetworkFee', () => {
    // Note: These tests run without TATUM_API_KEY, so they test fallback behavior
    // In production, the API would be called for real-time estimates
    
    describe('fallback behavior (no API key)', () => {
      it('should return fee for BTC with 20% buffer', async () => {
        const fee = await getEstimatedNetworkFee('BTC');
        
        // Fallback is $2.00, with 20% buffer = $2.40
        expect(fee).toBe(2.40);
      });

      it('should return fee for ETH with 20% buffer', async () => {
        const fee = await getEstimatedNetworkFee('ETH');
        
        // Fallback is $3.00, with 20% buffer = $3.60
        expect(fee).toBe(3.60);
      });

      it('should return fee for MATIC with minimum $0.01', async () => {
        const fee = await getEstimatedNetworkFee('MATIC');
        
        // Fallback is $0.01, with 20% buffer = $0.012, but minimum is $0.01
        expect(fee).toBeGreaterThanOrEqual(0.01);
      });

      it('should return fee for SOL with minimum $0.01', async () => {
        const fee = await getEstimatedNetworkFee('SOL');
        
        // Fallback is $0.001, with 20% buffer = $0.0012, but minimum is $0.01
        expect(fee).toBeGreaterThanOrEqual(0.01);
      });

      it('should return fee for BCH', async () => {
        const fee = await getEstimatedNetworkFee('BCH');
        
        // BCH uses static fallback
        expect(fee).toBeGreaterThanOrEqual(0.01);
      });
    });

    describe('USDC variants', () => {
      it('should use ETH fee for USDC_ETH', async () => {
        const ethFee = await getEstimatedNetworkFee('ETH');
        const usdcEthFee = await getEstimatedNetworkFee('USDC_ETH');
        
        expect(usdcEthFee).toBe(ethFee);
      });

      it('should use MATIC fee for USDC_MATIC', async () => {
        const maticFee = await getEstimatedNetworkFee('MATIC');
        const usdcMaticFee = await getEstimatedNetworkFee('USDC_MATIC');
        
        expect(usdcMaticFee).toBe(maticFee);
      });

      it('should use SOL fee for USDC_SOL', async () => {
        const solFee = await getEstimatedNetworkFee('SOL');
        const usdcSolFee = await getEstimatedNetworkFee('USDC_SOL');
        
        expect(usdcSolFee).toBe(solFee);
      });
    });

    describe('caching', () => {
      it('should cache fee results', async () => {
        const fee1 = await getEstimatedNetworkFee('BTC');
        const fee2 = await getEstimatedNetworkFee('BTC');
        
        // Both calls should return the same cached value
        expect(fee1).toBe(fee2);
      });

      it('should clear cache when clearFeeCache is called', async () => {
        const fee1 = await getEstimatedNetworkFee('BTC');
        
        clearFeeCache();
        
        const fee2 = await getEstimatedNetworkFee('BTC');
        
        // After cache clear, should still return same value (fallback)
        expect(fee1).toBe(fee2);
      });
    });

    describe('unknown blockchains', () => {
      it('should return default fee for unknown blockchain', async () => {
        const fee = await getEstimatedNetworkFee('UNKNOWN');
        
        // Should return conservative default with buffer
        expect(fee).toBeGreaterThanOrEqual(0.01);
      });
    });

    describe('fee constraints', () => {
      it('should ensure minimum fee of $0.01', async () => {
        const fee = await getEstimatedNetworkFee('SOL');
        
        expect(fee).toBeGreaterThanOrEqual(0.01);
      });

      it('should return positive fees for all supported chains', async () => {
        const chains = ['BTC', 'ETH', 'MATIC', 'SOL', 'BCH'];
        
        for (const chain of chains) {
          const fee = await getEstimatedNetworkFee(chain);
          expect(fee).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('getEstimatedNetworkFees', () => {
    it('should fetch fees for multiple blockchains', async () => {
      const fees = await getEstimatedNetworkFees(['BTC', 'ETH']);
      
      expect(fees).toHaveProperty('BTC');
      expect(fees).toHaveProperty('ETH');
      expect(fees['BTC']).toBeGreaterThan(0);
      expect(fees['ETH']).toBeGreaterThan(0);
    });

    it('should return empty object for empty array', async () => {
      const fees = await getEstimatedNetworkFees([]);
      
      expect(fees).toEqual({});
    });

    it('should fetch fees for all supported blockchains', async () => {
      const chains = ['BTC', 'ETH', 'MATIC', 'SOL', 'BCH'];
      const fees = await getEstimatedNetworkFees(chains);
      
      for (const chain of chains) {
        expect(fees).toHaveProperty(chain);
        expect(fees[chain]).toBeGreaterThan(0);
      }
    });
  });

  describe('fee reasonableness', () => {
    it('should have BTC fee higher than low-fee chains', async () => {
      const btcFee = await getEstimatedNetworkFee('BTC');
      const maticFee = await getEstimatedNetworkFee('MATIC');
      const solFee = await getEstimatedNetworkFee('SOL');
      
      expect(btcFee).toBeGreaterThan(maticFee);
      expect(btcFee).toBeGreaterThan(solFee);
    });

    it('should have ETH fee higher than low-fee chains', async () => {
      const ethFee = await getEstimatedNetworkFee('ETH');
      const maticFee = await getEstimatedNetworkFee('MATIC');
      const solFee = await getEstimatedNetworkFee('SOL');
      
      expect(ethFee).toBeGreaterThan(maticFee);
      expect(ethFee).toBeGreaterThan(solFee);
    });

    it('should have reasonable fee ranges', async () => {
      const btcFee = await getEstimatedNetworkFee('BTC');
      const ethFee = await getEstimatedNetworkFee('ETH');
      
      // BTC should be between $0.50 and $10
      expect(btcFee).toBeGreaterThanOrEqual(0.50);
      expect(btcFee).toBeLessThanOrEqual(10);
      
      // ETH should be between $0.50 and $15
      expect(ethFee).toBeGreaterThanOrEqual(0.50);
      expect(ethFee).toBeLessThanOrEqual(15);
    });
  });
});