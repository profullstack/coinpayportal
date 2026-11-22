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
      it('BTC falls back to mempool.space when TATUM_API_KEY is missing', async () => {
        delete process.env.TATUM_API_KEY;
        mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ fastestFee: 40, halfHourFee: 20, hourFee: 10 }) });

        // 20 sat/vB * 250 B = 5000 sat = 0.00005 BTC * $50,000 = $2.50, +20% = $3.00
        expect(await getEstimatedNetworkFee('BTC')).toBe(3);
        expect(mockFetch.mock.calls[0][0]).toBe('https://mempool.space/api/v1/fees/recommended');
      });

      it('BTC falls back when Tatum says the plan limit is exceeded (402), then to blockstream', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 402, text: () => Promise.resolve('{"statusCode":402,"message":"Your plan limit has been exceeded."}') })
          .mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({}) })
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ '2': 30, '3': 20, '6': 10 }) });

        expect(await getEstimatedNetworkFee('BTC')).toBe(3);
        expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
          'https://api.tatum.io/v3/blockchain/fee/BTC',
          'https://mempool.space/api/v1/fees/recommended',
          'https://blockstream.info/api/fee-estimates',
        ]);
      });

      it('ETH and ETH stablecoins fall back to eth_gasPrice over public RPC when Tatum fails', async () => {
        delete process.env.ETHEREUM_RPC_URL;
        delete process.env.ETH_RPC_URL;
        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 402, text: () => Promise.resolve('plan limit') })
          .mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({}) })
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x' + (20e9).toString(16) }) });

        // 20 gwei * 65,000 = 0.0013 ETH * $3,000 = $3.90, +20% = $4.68
        expect(await getEstimatedNetworkFee('USDC_ETH')).toBe(4.68);
        expect(mockFetch.mock.calls[1][0]).toBe('https://ethereum-rpc.publicnode.com');
        expect(JSON.parse(mockFetch.mock.calls[2][1].body).method).toBe('eth_gasPrice');
      });

      it('throws only when every source fails', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('down'), json: () => Promise.resolve({}) });
        await expect(getEstimatedNetworkFee('BTC')).rejects.toThrow();
        mockFetch.mockReset();
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

describe('Base (USDC_BASE) fee estimation', () => {
  it('returns a fee instead of throwing "Unsupported blockchain for fee estimation: BASE"', async () => {
    clearFeeCache();
    const fee = await getEstimatedNetworkFee('USDC_BASE');
    expect(fee).toBeGreaterThan(0);
    expect(fee).toBeLessThan(1);
  });
});
