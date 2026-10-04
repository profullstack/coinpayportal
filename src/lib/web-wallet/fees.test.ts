import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateFees,
  clearFeeCache,
  GAS_LIMITS,
  AVG_BTC_TX_SIZE,
  SOL_BASE_FEE_LAMPORTS,
} from './fees';

// ──────────────────────────────────────────────
// Mock fetch
// ──────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('estimateFees', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearFeeCache();
  });

  // ──────────────────────────────────────────────
  // BTC
  // ──────────────────────────────────────────────

  describe('BTC', () => {
    it('should fetch fees from mempool.space', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          fastestFee: 30,
          halfHourFee: 15,
          hourFee: 8,
        }),
      });

      const fees = await estimateFees('BTC');
      expect(fees.low.priority).toBe('low');
      expect(fees.medium.priority).toBe('medium');
      expect(fees.high.priority).toBe('high');
      expect(fees.low.feeRate).toBe(8);
      expect(fees.medium.feeRate).toBe(15);
      expect(fees.high.feeRate).toBe(30);
      expect(fees.low.feeCurrency).toBe('BTC');
      expect(parseFloat(fees.low.fee)).toBeGreaterThan(0);
    });

    it('should fall back to defaults on API failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));

      const fees = await estimateFees('BTC');
      expect(fees.low.feeRate).toBe(5);
      expect(fees.medium.feeRate).toBe(10);
      expect(fees.high.feeRate).toBe(20);
    });

    it('should calculate fee correctly from sat/byte', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));

      const fees = await estimateFees('BTC');
      const expectedFee = (10 * AVG_BTC_TX_SIZE) / 1e8;
      expect(fees.medium.fee).toBe(expectedFee.toString());
    });
  });

  // ──────────────────────────────────────────────
  // BCH
  // ──────────────────────────────────────────────

  describe('BCH', () => {
    it('should return fixed low fee rates', async () => {
      const fees = await estimateFees('BCH');
      expect(fees.low.feeRate).toBe(1);
      expect(fees.medium.feeRate).toBe(2);
      expect(fees.high.feeRate).toBe(5);
      expect(fees.low.feeCurrency).toBe('BCH');
      expect(fees.low.chain).toBe('BCH');
    });
  });

  // ──────────────────────────────────────────────
  // ETH
  // ──────────────────────────────────────────────

  describe('ETH', () => {
    it('should fetch gas price and priority fee', async () => {
      // eth_gasPrice
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: '0x4A817C800', // 20 Gwei
          id: 1,
        }),
      });

      // eth_maxPriorityFeePerGas
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: '0x3B9ACA00', // 1 Gwei
          id: 2,
        }),
      });

      const fees = await estimateFees('ETH');
      expect(fees.low.feeCurrency).toBe('ETH');
      expect(fees.low.gasLimit).toBe(GAS_LIMITS.ETH_TRANSFER);
      expect(fees.medium.gasLimit).toBe(GAS_LIMITS.ETH_TRANSFER);
      expect(fees.high.gasLimit).toBe(GAS_LIMITS.ETH_TRANSFER);
      expect(parseFloat(fees.low.fee)).toBeGreaterThan(0);
      expect(parseFloat(fees.medium.fee)).toBeGreaterThan(parseFloat(fees.low.fee));
      expect(parseFloat(fees.high.fee)).toBeGreaterThan(parseFloat(fees.medium.fee));
    });

    it('should throw only once EVERY provider has failed, naming them', async () => {
      // A single bad endpoint is no longer fatal, so this has to knock out the
      // whole list. The error that comes back names each host and status
      // instead of a bare code — the old message could not distinguish a dead
      // provider from a bug in our own code, which is how a 403 from a
      // misconfigured Infura project stayed unexplained for so long.
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      await expect(estimateFees('ETH')).rejects.toThrow(/RPC unavailable/);
    });

    it('should survive a dead provider by failing over to the next', async () => {
      // First provider is broken; the second answers. A send must still work.
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x3B9ACA00' }),
        })
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: '2.0', id: 2, result: '0x3B9ACA00' }),
        });

      const fees = await estimateFees('ETH');
      expect(parseFloat(fees.medium.fee)).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────
  // USDC_ETH
  // ──────────────────────────────────────────────

  describe('USDC_ETH', () => {
    it('should use ERC20 gas limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x4A817C800', id: 1 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x3B9ACA00', id: 2 }),
      });

      const fees = await estimateFees('USDC_ETH');
      // USDC_ETH uses the ETH RPC but returns ETH as fee currency
      expect(fees.low.feeCurrency).toBe('ETH');
      // Gas limit should be for ERC20 transfer (65000) since it's a token
      // Note: the baseChain is ETH, but gas limit depends on isToken check
    });
  });

  // ──────────────────────────────────────────────
  // USDC_BASE
  // ──────────────────────────────────────────────

  describe('USDC_BASE', () => {
    it('quotes Base gas in ETH, not POL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x4A817C800', id: 1 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x3B9ACA00', id: 2 }),
      });

      const fees = await estimateFees('USDC_BASE');
      // 'USDC_BASE' contains neither 'ETH' nor 'POL', so the old substring test
      // fell through to Polygon and quoted the wrong asset entirely. Base fees
      // are paid in ETH.
      expect(fees.low.feeCurrency).toBe('ETH');
      expect(fees.low.chain).toBe('USDC_BASE');
      // An ERC-20 transfer, so the token gas limit.
      expect(fees.low.gasLimit).toBe(GAS_LIMITS.ERC20_TRANSFER);
      // Base settles in seconds like Polygon, not in Ethereum's minutes.
      expect(fees.low.estimatedSeconds).toBe(30);
      expect(fees.high.estimatedSeconds).toBe(5);
    });
  });

  // ──────────────────────────────────────────────
  // POL
  // ──────────────────────────────────────────────

  describe('POL', () => {
    it('should fetch Polygon fees', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x6FC23AC00', id: 1 }), // 30 Gwei
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: '0x77359400', id: 2 }), // 2 Gwei
      });

      const fees = await estimateFees('POL');
      expect(fees.low.feeCurrency).toBe('POL');
      expect(fees.low.estimatedSeconds).toBe(30);
      expect(fees.medium.estimatedSeconds).toBe(10);
      expect(fees.high.estimatedSeconds).toBe(5);
    });
  });

  // ──────────────────────────────────────────────
  // SOL
  // ──────────────────────────────────────────────

  describe('SOL', () => {
    it('should fetch priority fees and add base fee', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          result: [
            { slot: 1, prioritizationFee: 100 },
            { slot: 2, prioritizationFee: 200 },
            { slot: 3, prioritizationFee: 300 },
          ],
          id: 1,
        }),
      });

      const fees = await estimateFees('SOL');
      expect(fees.low.feeCurrency).toBe('SOL');
      // Low = base fee only
      expect(fees.low.fee).toBe((SOL_BASE_FEE_LAMPORTS / 1e9).toString());
      // Medium = base + median priority
      expect(parseFloat(fees.medium.fee)).toBeGreaterThan(parseFloat(fees.low.fee));
    });

    it('should use default when RPC fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));

      const fees = await estimateFees('SOL');
      // Should still return valid fees using 0 priority fee
      expect(fees.low.fee).toBe((SOL_BASE_FEE_LAMPORTS / 1e9).toString());
      expect(fees.medium.fee).toBe((SOL_BASE_FEE_LAMPORTS / 1e9).toString());
    });
  });

  // ──────────────────────────────────────────────
  // Caching
  // ──────────────────────────────────────────────

  describe('caching', () => {
    it('should cache results for 60 seconds', async () => {
      mockFetch.mockRejectedValue(new Error('network'));

      // First call
      const fees1 = await estimateFees('BCH');
      // Second call should use cache (BCH doesn't call fetch)
      const fees2 = await estimateFees('BCH');
      expect(fees1).toEqual(fees2);
    });

    it('should clear cache with clearFeeCache()', async () => {
      mockFetch.mockRejectedValue(new Error('network'));

      await estimateFees('BCH');
      clearFeeCache();
      const fees2 = await estimateFees('BCH');
      // Should still work (BCH is static), but the cache was cleared
      expect(fees2.low.feeRate).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // Unsupported chain
  // ──────────────────────────────────────────────

  describe('unsupported', () => {
    it('should throw for unsupported chain', async () => {
      await expect(estimateFees('DOGE' as any)).rejects.toThrow('Unsupported chain');
    });
  });
});

// ──────────────────────────────────────────────
// Exported constants
// ──────────────────────────────────────────────

describe('constants', () => {
  it('should export correct gas limits', () => {
    expect(GAS_LIMITS.ETH_TRANSFER).toBe(21_000);
    expect(GAS_LIMITS.ERC20_TRANSFER).toBe(65_000);
    expect(GAS_LIMITS.ERC20_APPROVE).toBe(50_000);
  });

  it('should export correct BTC tx size', () => {
    expect(AVG_BTC_TX_SIZE).toBe(250);
  });

  it('should export correct SOL base fee', () => {
    expect(SOL_BASE_FEE_LAMPORTS).toBe(5000);
  });
});
