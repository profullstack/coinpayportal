import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getExchangeRate, getMultipleRates, getCryptoPrice, clearCache } from './tatum';

// Mock fetch
global.fetch = vi.fn();

describe('Tatum Exchange Rate Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache(); // Clear cache before each test
    process.env.TATUM_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    clearCache(); // Clear cache after each test
  });

  describe('getExchangeRate', () => {
    it('should fetch BTC to USD exchange rate', async () => {
      const mockResponse = {
        value: 45000.50,
        timestamp: Date.now(),
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const rate = await getExchangeRate('BTC', 'USD');

      expect(rate).toBe(45000.50);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/tatum/rate'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key',
          }),
        })
      );
    });

    it('should handle rate returned as string (Tatum API behavior)', async () => {
      // Tatum API sometimes returns rate as a string instead of number
      const mockResponse = {
        value: '45000.50', // String instead of number
        timestamp: Date.now(),
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const rate = await getExchangeRate('BTC', 'USD');

      expect(rate).toBe(45000.50);
      expect(typeof rate).toBe('number');
    });

    it('should handle rate returned as integer string', async () => {
      const mockResponse = {
        value: '3000', // Integer as string
        timestamp: Date.now(),
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const rate = await getExchangeRate('ETH', 'USD');

      expect(rate).toBe(3000);
      expect(typeof rate).toBe('number');
    });

    it('should reject invalid string rate values', async () => {
      const mockResponse = {
        value: 'invalid',
        timestamp: Date.now(),
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow('Invalid rate');
    });

    it('should reject empty string rate values', async () => {
      const mockResponse = {
        value: '',
        timestamp: Date.now(),
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow('Invalid rate');
    });

    it('should fetch ETH to USD exchange rate', async () => {
      const mockResponse = {
        value: 3000.25,
        timestamp: Date.now(),
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const rate = await getExchangeRate('ETH', 'USD');

      expect(rate).toBe(3000.25);
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow();
    });

    it('should throw error when API key is missing', async () => {
      delete process.env.TATUM_API_KEY;

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow('TATUM_API_KEY');
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      await expect(getExchangeRate('BTC', 'USD')).rejects.toThrow();
    });

    it('should support multiple cryptocurrencies', async () => {
      const currencies = ['BTC', 'ETH', 'SOL', 'MATIC'];
      
      for (const currency of currencies) {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ value: 1000, timestamp: Date.now() }),
        } as Response);

        const rate = await getExchangeRate(currency, 'USD');
        expect(rate).toBe(1000);
      }
    });

    it('should map MATIC to POL for Tatum API (Polygon rebrand)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 0.55, timestamp: Date.now() }),
      } as Response);

      const rate = await getExchangeRate('MATIC', 'USD');

      expect(rate).toBe(0.55);
      // Verify the API was called with POL instead of MATIC
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/tatum/rate/POL'),
        expect.any(Object)
      );
    });

    it('should handle lowercase matic and map to POL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 0.55, timestamp: Date.now() }),
      } as Response);

      const rate = await getExchangeRate('matic', 'USD');

      expect(rate).toBe(0.55);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/tatum/rate/POL'),
        expect.any(Object)
      );
    });
  });

  describe('getMultipleRates', () => {
    it('should fetch multiple exchange rates at once', async () => {
      const mockRates = {
        BTC: 45000,
        ETH: 3000,
        SOL: 100,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 45000, timestamp: Date.now() }),
      } as Response);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 3000, timestamp: Date.now() }),
      } as Response);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 100, timestamp: Date.now() }),
      } as Response);

      const rates = await getMultipleRates(['BTC', 'ETH', 'SOL'], 'USD');

      expect(rates).toEqual(mockRates);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 45000, timestamp: Date.now() }),
      } as Response);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
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
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 50000, timestamp: Date.now() }),
      } as Response);

      const cryptoAmount = await getCryptoPrice(100, 'USD', 'BTC');

      expect(cryptoAmount).toBeCloseTo(0.002, 6); // 100 / 50000, 6 decimal places
    });

    it('should handle decimal precision correctly', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 3000, timestamp: Date.now() }),
      } as Response);

      const cryptoAmount = await getCryptoPrice(150, 'USD', 'ETH');

      expect(cryptoAmount).toBeCloseTo(0.05, 6); // 150 / 3000, 6 decimal places
    });

    it('should throw error for zero or negative amounts', async () => {
      await expect(getCryptoPrice(0, 'USD', 'BTC')).rejects.toThrow();
      await expect(getCryptoPrice(-100, 'USD', 'BTC')).rejects.toThrow();
    });

    it('should handle very small amounts', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 50000, timestamp: Date.now() }),
      } as Response);

      const cryptoAmount = await getCryptoPrice(0.01, 'USD', 'BTC');

      expect(cryptoAmount).toBeGreaterThan(0);
      expect(cryptoAmount).toBeLessThan(0.001);
    });

    it('should handle very large amounts', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: 50000, timestamp: Date.now() }),
      } as Response);

      const cryptoAmount = await getCryptoPrice(1000000, 'USD', 'BTC');

      expect(cryptoAmount).toBeCloseTo(20, 6); // 1000000 / 50000, 6 decimal places
    });
  });

  describe('Rate caching', () => {
    it('should cache rates for 5 minutes', async () => {
      clearCache(); // Ensure clean state
      
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ value: 45000, timestamp: Date.now() }),
      } as Response);

      // First call
      const rate1 = await getExchangeRate('BTC', 'USD');
      expect(rate1).toBe(45000);
      
      // Second call within cache period (should use cache)
      const rate2 = await getExchangeRate('BTC', 'USD');
      expect(rate2).toBe(45000);

      // Should only call API once due to caching
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});