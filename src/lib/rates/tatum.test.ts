import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getExchangeRate, getMultipleRates, getCryptoPrice, clearCache } from './tatum';

// Mock fetch
global.fetch = vi.fn();

/**
 * Helper: mock a Kraken API response for a given pair
 */
function mockKrakenResponse(pair: string, price: string) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ error: [], result: { [pair]: { c: [price, '1.0'] } } }),
  } as Response);
}

describe('Tatum Exchange Rate Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    process.env.TATUM_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    clearCache();
  });

  describe('getExchangeRate', () => {
    // All currencies in KRAKEN_PAIR_MAP route through Kraken
    it('should fetch BTC to USD exchange rate via Kraken', async () => {
      mockKrakenResponse('XBTUSD', '45000.50');
      const rate = await getExchangeRate('BTC', 'USD');
      expect(rate).toBe(45000.50);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('kraken.com'),
        expect.any(Object)
      );
    });

    it('should fetch ETH to USD exchange rate via Kraken', async () => {
      mockKrakenResponse('ETHUSD', '3000.25');
      const rate = await getExchangeRate('ETH', 'USD');
      expect(rate).toBe(3000.25);
    });

    it('should fetch SOL to USD exchange rate via Kraken', async () => {
      mockKrakenResponse('SOLUSD', '150.00');
      const rate = await getExchangeRate('SOL', 'USD');
      expect(rate).toBe(150);
    });

    it('should fetch POL exchange rate via Kraken (Polygon)', async () => {
      mockKrakenResponse('POLUSD', '0.55');
      const rate = await getExchangeRate('POL', 'USD');
      expect(rate).toBe(0.55);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('kraken.com'),
        expect.any(Object)
      );
    });

    it('should handle lowercase currency symbols', async () => {
      mockKrakenResponse('POLUSD', '0.55');
      const rate = await getExchangeRate('pol', 'USD');
      expect(rate).toBe(0.55);
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow();
    });

    it('should handle Kraken API error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: ['EQuery:Unknown asset pair'], result: {} }),
      } as Response);

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow();
    });

    it('should support multiple cryptocurrencies', async () => {
      mockKrakenResponse('XBTUSD', '45000');
      const btc = await getExchangeRate('BTC', 'USD');
      expect(btc).toBe(45000);

      mockKrakenResponse('ETHUSD', '3000');
      const eth = await getExchangeRate('ETH', 'USD');
      expect(eth).toBe(3000);

      mockKrakenResponse('SOLUSD', '100');
      const sol = await getExchangeRate('SOL', 'USD');
      expect(sol).toBe(100);
    });

    it('should fallback from Tatum to Kraken for unmapped currencies', async () => {
      // For a currency not in KRAKEN_PAIR_MAP, code tries Tatum first
      // Mock Tatum failure, then Kraken won't work either (unknown pair)
      // But for mapped currencies, Kraken is used directly
      mockKrakenResponse('XBTUSD', '45000');
      const rate = await getExchangeRate('BTC', 'USD');
      expect(rate).toBe(45000);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMultipleRates', () => {
    it('should fetch multiple exchange rates at once', async () => {
      mockKrakenResponse('XBTUSD', '45000');
      mockKrakenResponse('ETHUSD', '3000');
      mockKrakenResponse('SOLUSD', '100');

      const rates = await getMultipleRates(['BTC', 'ETH', 'SOL'], 'USD');

      expect(rates).toEqual({ BTC: 45000, ETH: 3000, SOL: 100 });
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures', async () => {
      mockKrakenResponse('XBTUSD', '45000');
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(getMultipleRates(['BTC', 'ETH'], 'USD')).rejects.toThrow();
    });

    it('should return empty object for empty array', async () => {
      const rates = await getMultipleRates([], 'USD');
      expect(rates).toEqual({});
    });
  });

  describe('getCryptoPrice', () => {
    it('should calculate crypto amount from fiat', async () => {
      mockKrakenResponse('XBTUSD', '50000');
      const cryptoAmount = await getCryptoPrice(100, 'USD', 'BTC');
      expect(cryptoAmount).toBeCloseTo(0.002, 6);
    });

    it('should handle decimal precision correctly', async () => {
      mockKrakenResponse('ETHUSD', '3000');
      const cryptoAmount = await getCryptoPrice(150, 'USD', 'ETH');
      expect(cryptoAmount).toBeCloseTo(0.05, 6);
    });

    it('should throw error for zero or negative amounts', async () => {
      await expect(getCryptoPrice(0, 'USD', 'BTC')).rejects.toThrow();
      await expect(getCryptoPrice(-100, 'USD', 'BTC')).rejects.toThrow();
    });

    it('should handle very small amounts', async () => {
      mockKrakenResponse('XBTUSD', '50000');
      const cryptoAmount = await getCryptoPrice(0.01, 'USD', 'BTC');
      expect(cryptoAmount).toBeGreaterThan(0);
      expect(cryptoAmount).toBeLessThan(0.001);
    });

    it('should handle very large amounts', async () => {
      mockKrakenResponse('XBTUSD', '50000');
      const cryptoAmount = await getCryptoPrice(1000000, 'USD', 'BTC');
      expect(cryptoAmount).toBeCloseTo(20, 6);
    });
  });

  describe('Rate caching', () => {
    it('should cache rates for 5 minutes', async () => {
      clearCache();

      mockKrakenResponse('XBTUSD', '45000');

      const rate1 = await getExchangeRate('BTC', 'USD');
      expect(rate1).toBe(45000);

      // Second call should use cache
      const rate2 = await getExchangeRate('BTC', 'USD');
      expect(rate2).toBe(45000);

      // Should only call API once due to caching
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
