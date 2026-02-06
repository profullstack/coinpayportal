import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  getSwapQuote, 
  createSwap, 
  CN_COIN_MAP,
  resetClient,
  SWAP_SUPPORTED_COINS,
  isSwapSupported,
} from './changenow';

// Mock fetch globally
global.fetch = vi.fn();

describe('ChangeNOW Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    resetClient();
    process.env = { ...originalEnv, CHANGENOW_API_KEY: 'test-api-key' };
  });

  afterEach(() => {
    vi.resetAllMocks();
    process.env = originalEnv;
  });

  describe('SWAP_SUPPORTED_COINS', () => {
    it('should include all coins our wallet supports', () => {
      expect(SWAP_SUPPORTED_COINS).toEqual([
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'BNB', 'DOGE', 'XRP', 'ADA',
        'USDT', 'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL',
      ]);
    });

    it('should have mappings for all supported coins', () => {
      expect(CN_COIN_MAP['BTC']).toEqual({ ticker: 'btc', network: 'btc' });
      expect(CN_COIN_MAP['ETH']).toEqual({ ticker: 'eth', network: 'eth' });
      expect(CN_COIN_MAP['SOL']).toEqual({ ticker: 'sol', network: 'sol' });
      expect(CN_COIN_MAP['POL']).toEqual({ ticker: 'matic', network: 'matic' });
      expect(CN_COIN_MAP['BCH']).toEqual({ ticker: 'bch', network: 'bch' });
      expect(CN_COIN_MAP['BNB']).toEqual({ ticker: 'bnbbsc', network: 'bsc' });
      expect(CN_COIN_MAP['DOGE']).toEqual({ ticker: 'doge', network: 'doge' });
      expect(CN_COIN_MAP['XRP']).toEqual({ ticker: 'xrp', network: 'xrp' });
      expect(CN_COIN_MAP['ADA']).toEqual({ ticker: 'ada', network: 'ada' });
      expect(CN_COIN_MAP['USDT']).toEqual({ ticker: 'usdterc20', network: 'eth' });
      expect(CN_COIN_MAP['USDC']).toEqual({ ticker: 'usdc', network: 'eth' });
      expect(CN_COIN_MAP['USDC_POL']).toEqual({ ticker: 'usdcmatic', network: 'matic' });
      expect(CN_COIN_MAP['USDC_SOL']).toEqual({ ticker: 'usdcsol', network: 'sol' });
    });

    it('isSwapSupported should validate correctly', () => {
      expect(isSwapSupported('BTC')).toBe(true);
      expect(isSwapSupported('ETH')).toBe(true);
      expect(isSwapSupported('DOGE')).toBe(true);
      expect(isSwapSupported('USDC')).toBe(true);
      expect(isSwapSupported('FAKE')).toBe(false);
      expect(isSwapSupported('SHIB')).toBe(false);
    });
  });

  describe('getSwapQuote', () => {
    it('should get a quote for BTC to ETH swap', async () => {
      vi.mocked(fetch)
        // First call: estimate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            estimatedAmount: 1.5,
            transactionSpeedForecast: '10-60',
            warningMessage: null,
          }),
        } as Response)
        // Second call: min amount
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ minAmount: 0.001 }),
        } as Response);

      const quote = await getSwapQuote({
        from: 'BTC',
        to: 'ETH',
        amount: '0.1',
      });

      expect(quote.depositAmount).toBe('0.1');
      expect(quote.settleAmount).toBe('1.5');
      expect(quote.minAmount).toBe(0.001);
    });

    it('should throw for unsupported coin', async () => {
      await expect(
        getSwapQuote({
          from: 'SHIB',
          to: 'ETH',
          amount: '100',
        })
      ).rejects.toThrow('Unsupported coin: SHIB');
    });

    it('should throw when trying to swap same coin', async () => {
      await expect(
        getSwapQuote({
          from: 'BTC',
          to: 'BTC',
          amount: '0.1',
        })
      ).rejects.toThrow('Cannot swap a coin for itself');
    });
  });

  describe('createSwap', () => {
    it('should create an exchange', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'txn-123',
          payinAddress: 'bc1qtest...',
          payoutAddress: '0xabc...',
          fromCurrency: 'btc',
          toCurrency: 'eth',
          fromNetwork: 'btc',
          toNetwork: 'eth',
          amount: 0.1,
          status: 'waiting',
          createdAt: '2026-02-06T00:00:00Z',
        }),
      } as Response);

      const shift = await createSwap({
        from: 'BTC',
        to: 'ETH',
        amount: '0.1',
        settleAddress: '0xabc...',
        quoteId: '',
      });

      expect(shift.id).toBe('txn-123');
      expect(shift.status).toBe('pending');
      expect(shift.depositAddress).toBe('bc1qtest...');
    });
  });

  describe('error handling', () => {
    it('should throw on API error from estimate endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Invalid amount' }),
      } as Response);

      // getSwapQuote calls both estimate AND minAmount in parallel
      // The first one to fail will throw
      await expect(
        getSwapQuote({
          from: 'BTC',
          to: 'ETH',
          amount: '0.00001',
        })
      ).rejects.toThrow();
    });
  });
});
