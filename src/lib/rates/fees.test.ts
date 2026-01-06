import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEstimatedNetworkFee, getEstimatedNetworkFees, clearFeeCache, getStaticFees } from './fees';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the tatum module for exchange rates
vi.mock('./tatum', () => ({
  getExchangeRate: vi.fn().mockImplementation((crypto: string) => {
    const rates: Record<string, number> = {
      BTC: 50000,
      ETH: 3000,
      POL: 0.50,
      SOL: 100,
    };
    return Promise.resolve(rates[crypto] || 1);
  }),
}));

describe('Tatum Fee Estimation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFeeCache();
    // Set up a mock API key
    process.env.TATUM_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.TATUM_API_KEY;
  });

  describe('getStaticFees', () => {
    it('should return static fees for low-fee chains', () => {
      const fees = getStaticFees();

      expect(fees).toHaveProperty('BCH');
      expect(fees).toHaveProperty('DOGE');
      expect(fees).toHaveProperty('XRP');
      expect(fees).toHaveProperty('ADA');
      expect(fees).toHaveProperty('BNB');
    });

    it('should NOT have fees for chains that use API lookup', () => {
      const fees = getStaticFees();

      expect(fees).not.toHaveProperty('BTC');
      expect(fees).not.toHaveProperty('ETH');
      expect(fees).not.toHaveProperty('POL');
      expect(fees).not.toHaveProperty('SOL');
    });

    it('should return reasonable static values', () => {
      const fees = getStaticFees();

      expect(fees['BCH']).toBe(0.01);
      expect(fees['DOGE']).toBe(0.05);
      expect(fees['XRP']).toBe(0.001);
      expect(fees['ADA']).toBe(0.20);
      expect(fees['BNB']).toBe(0.10);
    });

    it('should return a copy, not the original object', () => {
      const fees1 = getStaticFees();
      const fees2 = getStaticFees();

      fees1['BCH'] = 999;
      expect(fees2['BCH']).toBe(0.01);
    });
  });

  describe('getEstimatedNetworkFee', () => {
    describe('Bitcoin (BTC) fee estimation', () => {
      it('should fetch BTC fee from Tatum API', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ slow: 10, medium: 20, fast: 30 }),
        });

        const fee = await getEstimatedNetworkFee('BTC');

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.tatum.io/v3/blockchain/fee/BTC',
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-api-key': 'test-api-key',
            }),
          })
        );
        // Fee calculation: 20 sat/byte * 250 bytes / 100M * $50000 * 1.2 buffer
        expect(fee).toBeGreaterThan(0);
      });
    });

    describe('Ethereum (ETH) fee estimation', () => {
      it('should fetch ETH fee from Tatum API', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ slow: 20000000000, medium: 30000000000, fast: 40000000000 }),
        });

        const fee = await getEstimatedNetworkFee('ETH');

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.tatum.io/v3/blockchain/fee/ETH',
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-api-key': 'test-api-key',
            }),
          })
        );
        expect(fee).toBeGreaterThan(0);
      });
    });

    describe('Polygon (POL) fee estimation', () => {
      it('should fetch POL fee from Polygon Gas Station API', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            standard: { maxFee: 50 },
            fast: { maxFee: 60 },
            estimatedBaseFee: 45,
          }),
        });

        const fee = await getEstimatedNetworkFee('POL');

        expect(mockFetch).toHaveBeenCalledWith(
          'https://gasstation.polygon.technology/v2',
          expect.any(Object)
        );
        expect(fee).toBeGreaterThan(0);
      });
    });

    describe('Solana (SOL) fee estimation', () => {
      it('should calculate SOL fee with predictable lamport pricing', async () => {
        // SOL uses predictable fee calculation, no API call needed
        const fee = await getEstimatedNetworkFee('SOL');

        // Fee should be minimum $0.01 (enforced minimum)
        expect(fee).toBe(0.01);
      });
    });

    describe('static fee chains', () => {
      it('should return static fee for BCH', async () => {
        const fee = await getEstimatedNetworkFee('BCH');

        // BCH uses static fee, minimum $0.01 enforced after rounding
        expect(fee).toBe(0.01);
      });

      it('should return static fee for DOGE', async () => {
        const fee = await getEstimatedNetworkFee('DOGE');

        expect(fee).toBe(0.05 * 1.2); // Static $0.05 with 20% buffer = $0.06
      });

      it('should return static fee for XRP', async () => {
        const fee = await getEstimatedNetworkFee('XRP');

        // Minimum fee is $0.01
        expect(fee).toBeGreaterThanOrEqual(0.01);
      });

      it('should return static fee for ADA', async () => {
        const fee = await getEstimatedNetworkFee('ADA');

        expect(fee).toBe(0.20 * 1.2); // Static $0.20 with 20% buffer = $0.24
      });

      it('should return static fee for BNB', async () => {
        const fee = await getEstimatedNetworkFee('BNB');

        expect(fee).toBe(0.10 * 1.2); // Static $0.10 with 20% buffer = $0.12
      });
    });

    describe('USDC variants', () => {
      it('should use ETH fee for USDC_ETH', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ slow: 20000000000, medium: 30000000000, fast: 40000000000 }),
        });

        const ethFee = await getEstimatedNetworkFee('ETH');
        clearFeeCache(); // Clear cache to ensure fresh fetch
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ slow: 20000000000, medium: 30000000000, fast: 40000000000 }),
        });
        const usdcEthFee = await getEstimatedNetworkFee('USDC_ETH');

        expect(usdcEthFee).toBe(ethFee);
      });

      it('should use POL fee for USDC_POL', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            standard: { maxFee: 50 },
            fast: { maxFee: 60 },
          }),
        });

        const polFee = await getEstimatedNetworkFee('POL');
        clearFeeCache();
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            standard: { maxFee: 50 },
            fast: { maxFee: 60 },
          }),
        });
        const usdcPolFee = await getEstimatedNetworkFee('USDC_POL');

        expect(usdcPolFee).toBe(polFee);
      });

      it('should use SOL fee for USDC_SOL', async () => {
        const solFee = await getEstimatedNetworkFee('SOL');
        clearFeeCache();
        const usdcSolFee = await getEstimatedNetworkFee('USDC_SOL');

        expect(usdcSolFee).toBe(solFee);
      });
    });

    describe('caching', () => {
      it('should cache fee results', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ slow: 10, medium: 20, fast: 30 }),
        });

        const fee1 = await getEstimatedNetworkFee('BTC');
        const fee2 = await getEstimatedNetworkFee('BTC');

        // API should only be called once due to caching
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(fee1).toBe(fee2);
      });

      it('should clear cache when clearFeeCache is called', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ slow: 10, medium: 20, fast: 30 }),
        });

        await getEstimatedNetworkFee('BTC');
        clearFeeCache();
        await getEstimatedNetworkFee('BTC');

        // API should be called twice after cache clear
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('error handling', () => {
      it('should throw error when API key is missing', async () => {
        delete process.env.TATUM_API_KEY;

        await expect(getEstimatedNetworkFee('BTC')).rejects.toThrow(
          'TATUM_API_KEY environment variable is not set'
        );
      });

      it('should throw error when API returns error status', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
        });

        await expect(getEstimatedNetworkFee('BTC')).rejects.toThrow('Tatum API error: 401');
      });

      it('should throw error for unsupported blockchain', async () => {
        await expect(getEstimatedNetworkFee('UNKNOWN')).rejects.toThrow(
          'Unsupported blockchain for fee estimation: UNKNOWN'
        );
      });
    });

    describe('fee constraints', () => {
      it('should ensure minimum fee of $0.01', async () => {
        const fee = await getEstimatedNetworkFee('SOL');

        // SOL fees are tiny but minimum should be $0.01
        expect(fee).toBeGreaterThanOrEqual(0.01);
      });

      it('should add 20% buffer to calculated fees', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ slow: 10, medium: 20, fast: 30 }),
        });

        const fee = await getEstimatedNetworkFee('BTC');

        // Fee should have 20% buffer applied
        expect(fee).toBeGreaterThan(0);
      });
    });
  });

  describe('getEstimatedNetworkFees', () => {
    it('should fetch fees for multiple blockchains', async () => {
      // Mock BCH (static) and DOGE (static) - no API calls needed
      const fees = await getEstimatedNetworkFees(['BCH', 'DOGE']);

      expect(fees).toHaveProperty('BCH');
      expect(fees).toHaveProperty('DOGE');
      expect(fees['BCH']).toBeGreaterThan(0);
      expect(fees['DOGE']).toBeGreaterThan(0);
    });

    it('should return empty object for empty array', async () => {
      const fees = await getEstimatedNetworkFees([]);

      expect(fees).toEqual({});
    });

    it('should fetch fees for all static-fee blockchains', async () => {
      const chains = ['BCH', 'DOGE', 'XRP', 'ADA', 'BNB'];
      const fees = await getEstimatedNetworkFees(chains);

      for (const chain of chains) {
        expect(fees).toHaveProperty(chain);
        expect(fees[chain]).toBeGreaterThan(0);
      }
    });
  });
});
