import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  getSwapQuote, 
  createSwap,
  getSwapStatus,
  CN_COIN_MAP,
  resetClient,
  SWAP_SUPPORTED_COINS,
  isSwapSupported,
} from './changenow';

// Mock fetch globally
global.fetch = vi.fn();

describe('ChangeNOW Client (v2 API)', () => {
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
        'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
        'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL',
      ]);
    });

    it('should have mappings for all supported coins', () => {
      // Native coins
      expect(CN_COIN_MAP['BTC']).toEqual({ ticker: 'btc', network: 'btc' });
      expect(CN_COIN_MAP['ETH']).toEqual({ ticker: 'eth', network: 'eth' });
      expect(CN_COIN_MAP['SOL']).toEqual({ ticker: 'sol', network: 'sol' });
      expect(CN_COIN_MAP['POL']).toEqual({ ticker: 'matic', network: 'matic' });
      expect(CN_COIN_MAP['BCH']).toEqual({ ticker: 'bch', network: 'bch' });
      expect(CN_COIN_MAP['BNB']).toEqual({ ticker: 'bnbbsc', network: 'bsc' });
      expect(CN_COIN_MAP['DOGE']).toEqual({ ticker: 'doge', network: 'doge' });
      expect(CN_COIN_MAP['XRP']).toEqual({ ticker: 'xrp', network: 'xrp' });
      expect(CN_COIN_MAP['ADA']).toEqual({ ticker: 'ada', network: 'ada' });
      // USDT variants
      expect(CN_COIN_MAP['USDT']).toEqual({ ticker: 'usdterc20', network: 'eth' });
      expect(CN_COIN_MAP['USDT_ETH']).toEqual({ ticker: 'usdterc20', network: 'eth' });
      expect(CN_COIN_MAP['USDT_POL']).toEqual({ ticker: 'usdtmatic', network: 'matic' });
      expect(CN_COIN_MAP['USDT_SOL']).toEqual({ ticker: 'usdtsol', network: 'sol' });
      // USDC variants
      expect(CN_COIN_MAP['USDC']).toEqual({ ticker: 'usdc', network: 'eth' });
      expect(CN_COIN_MAP['USDC_ETH']).toEqual({ ticker: 'usdc', network: 'eth' });
      expect(CN_COIN_MAP['USDC_POL']).toEqual({ ticker: 'usdcmatic', network: 'matic' });
      expect(CN_COIN_MAP['USDC_SOL']).toEqual({ ticker: 'usdcsol', network: 'sol' });
    });

    it('isSwapSupported should validate correctly', () => {
      expect(isSwapSupported('BTC')).toBe(true);
      expect(isSwapSupported('ETH')).toBe(true);
      expect(isSwapSupported('DOGE')).toBe(true);
      expect(isSwapSupported('USDC')).toBe(true);
      expect(isSwapSupported('USDC_POL')).toBe(true);
      expect(isSwapSupported('USDT')).toBe(true);
      expect(isSwapSupported('USDT_SOL')).toBe(true);
      expect(isSwapSupported('FAKE')).toBe(false);
      expect(isSwapSupported('SHIB')).toBe(false);
    });
  });

  describe('getSwapQuote (v2 API)', () => {
    it('should get a quote for BTC to ETH swap', async () => {
      vi.mocked(fetch)
        // First call: v2 estimate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            fromCurrency: 'btc',
            toCurrency: 'eth',
            fromNetwork: 'btc',
            toNetwork: 'eth',
            flow: 'standard',
            fromAmount: 0.1,
            toAmount: 1.5,
            transactionSpeedForecast: '10-60',
            warningMessage: null,
          }),
        } as Response)
        // Second call: v2 min amount
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            fromCurrency: 'btc',
            toCurrency: 'eth',
            minAmount: 0.001,
          }),
        } as Response);

      const quote = await getSwapQuote({
        from: 'BTC',
        to: 'ETH',
        amount: '0.1',
      });

      expect(quote.depositAmount).toBe('0.1');
      expect(quote.settleAmount).toBe('1.5');
      expect(quote.minAmount).toBe(0.001);
      expect(quote.rate).toBe('15'); // 1.5 / 0.1 = 15
    });

    it('should use correct v2 API endpoint with network params', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            fromAmount: 10,
            toAmount: 0.0005,
            transactionSpeedForecast: '10-60',
            warningMessage: null,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ minAmount: 2.0 }),
        } as Response);

      await getSwapQuote({
        from: 'POL',
        to: 'ETH',
        amount: '10',
      });

      // Check estimate call uses v2 endpoint with network
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/exchange/estimated-amount'),
        expect.any(Object)
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('fromNetwork=matic'),
        expect.any(Object)
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('toNetwork=eth'),
        expect.any(Object)
      );
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

  describe('createSwap (v2 API)', () => {
    it('should create an exchange with v2 API', async () => {
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
          fromAmount: 0.1,
          expectedAmountTo: 1.5,
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
      expect(shift.status).toBe('pending'); // mapped from 'waiting'
      expect(shift.depositAddress).toBe('bc1qtest...');
      expect(shift.depositAmount).toBe('0.1'); // Should be input amount, NOT receive amount
    });

    it('should use v2 endpoint with correct body format', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'txn-456',
          payinAddress: '0xdeposit...',
          payoutAddress: '0xpayout...',
          fromCurrency: 'matic',
          toCurrency: 'eth',
          fromNetwork: 'matic',
          toNetwork: 'eth',
          fromAmount: 8,
          status: 'waiting',
          createdAt: '2026-02-06T00:00:00Z',
        }),
      } as Response);

      await createSwap({
        from: 'POL',
        to: 'ETH',
        amount: '8',
        settleAddress: '0xpayout...',
        refundAddress: '0xrefund...',
        quoteId: '',
      });

      // Check v2 endpoint
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/exchange'),
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Check body format
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.fromCurrency).toBe('matic');
      expect(body.toCurrency).toBe('eth');
      expect(body.fromNetwork).toBe('matic');
      expect(body.toNetwork).toBe('eth');
      expect(body.fromAmount).toBe(8);
      expect(body.flow).toBe('standard');
    });

    it('should return depositAmount as input amount, not receive amount', async () => {
      // This is the critical bug fix test - depositAmount must be what we SEND
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'txn-789',
          payinAddress: '0xdeposit...',
          payoutAddress: '0xpayout...',
          fromCurrency: 'matic',
          toCurrency: 'eth',
          fromNetwork: 'matic',
          toNetwork: 'eth',
          fromAmount: 8,
          expectedAmountTo: 0.0002212, // This is what we RECEIVE
          status: 'waiting',
          createdAt: '2026-02-06T00:00:00Z',
        }),
      } as Response);

      const shift = await createSwap({
        from: 'POL',
        to: 'ETH',
        amount: '8', // This is what we SEND
        settleAddress: '0xpayout...',
        quoteId: '',
      });

      // depositAmount should be 8 (what we send), NOT 0.0002212 (what we receive)
      expect(shift.depositAmount).toBe('8');
    });
  });

  describe('getSwapStatus (v2 API)', () => {
    it('should get accurate status from v2 API', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'txn-123',
          status: 'finished',
          payinAddress: '0xdeposit...',
          payoutAddress: '0xpayout...',
          fromCurrency: 'matic',
          toCurrency: 'eth',
          fromNetwork: 'matic',
          toNetwork: 'eth',
          expectedAmountFrom: 8,
          expectedAmountTo: 0.0002212,
          amountFrom: 8,
          amountTo: 0.0002200,
          payoutHash: '0xpayouthash...',
          createdAt: '2026-02-06T00:00:00Z',
        }),
      } as Response);

      const status = await getSwapStatus('txn-123');

      expect(status.id).toBe('txn-123');
      expect(status.status).toBe('settled'); // mapped from 'finished'
    });

    it('should use v2 by-id endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'txn-123',
          status: 'waiting',
          payinAddress: '0x...',
          payoutAddress: '0x...',
          fromCurrency: 'btc',
          toCurrency: 'eth',
          createdAt: '2026-02-06T00:00:00Z',
        }),
      } as Response);

      await getSwapStatus('txn-123');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/exchange/by-id?id=txn-123'),
        expect.any(Object)
      );
    });

    it('should include x-changenow-api-key header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'txn-123',
          status: 'waiting',
          payinAddress: '0x...',
          payoutAddress: '0x...',
          fromCurrency: 'btc',
          toCurrency: 'eth',
          createdAt: '2026-02-06T00:00:00Z',
        }),
      } as Response);

      await getSwapStatus('txn-123');

      const callArgs = vi.mocked(fetch).mock.calls[0];
      expect(callArgs[1]?.headers).toMatchObject({
        'x-changenow-api-key': 'test-api-key',
      });
    });
  });

  describe('status mapping', () => {
    const statusTests = [
      { v2: 'new', expected: 'pending' },
      { v2: 'waiting', expected: 'pending' },
      { v2: 'confirming', expected: 'processing' },
      { v2: 'exchanging', expected: 'processing' },
      { v2: 'sending', expected: 'settling' },
      { v2: 'finished', expected: 'settled' },
      { v2: 'failed', expected: 'failed' },
      { v2: 'refunded', expected: 'refunded' },
      { v2: 'expired', expected: 'expired' },
    ];

    statusTests.forEach(({ v2, expected }) => {
      it(`should map '${v2}' status to '${expected}'`, async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'txn-123',
            status: v2,
            payinAddress: '0x...',
            payoutAddress: '0x...',
            fromCurrency: 'btc',
            toCurrency: 'eth',
            createdAt: '2026-02-06T00:00:00Z',
          }),
        } as Response);

        const status = await getSwapStatus('txn-123');
        expect(status.status).toBe(expected);
      });
    });
  });

  describe('error handling', () => {
    it('should throw on API error from estimate endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Invalid amount' }),
      } as Response);

      await expect(
        getSwapQuote({
          from: 'BTC',
          to: 'ETH',
          amount: '0.00001',
        })
      ).rejects.toThrow();
    });

    it('should throw when minimum not met', async () => {
      // getSwapQuote calls both estimate AND minAmount in parallel
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ 
            error: 'out_of_range',
            message: 'Amount is less then minimal: 2.1669262 MATICMAINNET',
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ minAmount: 2.1669262 }),
        } as Response);

      await expect(
        getSwapQuote({
          from: 'POL',
          to: 'ETH',
          amount: '1',
        })
      ).rejects.toThrow('Amount is less then minimal');
    });
  });
});
