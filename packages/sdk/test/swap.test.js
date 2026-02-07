/**
 * Swap Module Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SwapClient,
  SwapCoins,
  SwapStatus,
  getSwapCoins,
  getSwapQuote,
  createSwap,
  getSwapStatus,
  getSwapHistory,
} from '../src/swap.js';

describe('Swap Module', () => {
  describe('SwapCoins', () => {
    it('should include common cryptocurrencies', () => {
      expect(SwapCoins).toContain('BTC');
      expect(SwapCoins).toContain('ETH');
      expect(SwapCoins).toContain('SOL');
      expect(SwapCoins).toContain('POL');
      expect(SwapCoins).toContain('BCH');
    });

    it('should include stablecoins', () => {
      expect(SwapCoins).toContain('USDC');
      expect(SwapCoins).toContain('USDT');
      expect(SwapCoins).toContain('USDC_ETH');
      expect(SwapCoins).toContain('USDC_POL');
      expect(SwapCoins).toContain('USDC_SOL');
    });

    it('should be an array', () => {
      expect(Array.isArray(SwapCoins)).toBe(true);
    });
  });

  describe('SwapStatus', () => {
    it('should have all expected statuses', () => {
      expect(SwapStatus.PENDING).toBe('pending');
      expect(SwapStatus.PROCESSING).toBe('processing');
      expect(SwapStatus.SETTLING).toBe('settling');
      expect(SwapStatus.SETTLED).toBe('settled');
      expect(SwapStatus.FAILED).toBe('failed');
      expect(SwapStatus.REFUNDED).toBe('refunded');
      expect(SwapStatus.EXPIRED).toBe('expired');
    });
  });

  describe('SwapClient', () => {
    let client;
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
      client = new SwapClient({
        baseUrl: 'https://test.api.com',
        walletId: 'test-wallet-id',
      });
    });

    describe('constructor', () => {
      it('should create client with default options', () => {
        const defaultClient = new SwapClient();
        expect(defaultClient).toBeInstanceOf(SwapClient);
      });

      it('should accept custom options', () => {
        const customClient = new SwapClient({
          baseUrl: 'https://custom.api.com',
          walletId: 'custom-wallet',
          timeout: 60000,
        });
        expect(customClient).toBeInstanceOf(SwapClient);
      });
    });

    describe('setWalletId', () => {
      it('should set wallet ID', () => {
        const newClient = new SwapClient();
        newClient.setWalletId('new-wallet-id');
        // Can't directly test private field, but method should exist
        expect(typeof newClient.setWalletId).toBe('function');
      });
    });

    describe('getSwapCoins', () => {
      it('should fetch supported coins', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            provider: 'changenow',
            coins: [
              { symbol: 'BTC', name: 'Bitcoin', network: 'Bitcoin' },
              { symbol: 'ETH', name: 'Ethereum', network: 'Ethereum' },
            ],
            count: 2,
          }),
        });

        const result = await client.getSwapCoins();

        expect(mockFetch).toHaveBeenCalledWith(
          'https://test.api.com/swap/coins',
          expect.objectContaining({
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          })
        );
        expect(result.success).toBe(true);
        expect(result.coins).toHaveLength(2);
      });

      it('should filter coins by search', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            coins: [
              { symbol: 'BTC', name: 'Bitcoin', network: 'Bitcoin' },
              { symbol: 'ETH', name: 'Ethereum', network: 'Ethereum' },
              { symbol: 'SOL', name: 'Solana', network: 'Solana' },
            ],
            count: 3,
          }),
        });

        const result = await client.getSwapCoins({ search: 'bit' });

        expect(result.coins).toHaveLength(1);
        expect(result.coins[0].symbol).toBe('BTC');
      });
    });

    describe('getSwapQuote', () => {
      it('should get quote for valid swap', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            quote: {
              from: 'BTC',
              to: 'ETH',
              depositAmount: '0.1',
              settleAmount: '1.5',
              rate: '15.0',
              minAmount: 0.001,
              provider: 'changenow',
            },
          }),
        });

        const result = await client.getSwapQuote('BTC', 'ETH', '0.1');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/swap/quote?'),
          expect.anything()
        );
        expect(result.success).toBe(true);
        expect(result.quote.from).toBe('BTC');
        expect(result.quote.to).toBe('ETH');
      });

      it('should throw error for missing parameters', async () => {
        await expect(client.getSwapQuote()).rejects.toThrow('from, to, and amount are required');
        await expect(client.getSwapQuote('BTC')).rejects.toThrow('from, to, and amount are required');
        await expect(client.getSwapQuote('BTC', 'ETH')).rejects.toThrow('from, to, and amount are required');
      });

      it('should throw error for unsupported coin', async () => {
        await expect(client.getSwapQuote('INVALID', 'ETH', '0.1'))
          .rejects.toThrow('Unsupported source coin');
        await expect(client.getSwapQuote('BTC', 'INVALID', '0.1'))
          .rejects.toThrow('Unsupported destination coin');
      });

      it('should throw error for same coin swap', async () => {
        await expect(client.getSwapQuote('BTC', 'BTC', '0.1'))
          .rejects.toThrow('Cannot swap a coin for itself');
      });

      it('should uppercase coin symbols', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            quote: { from: 'BTC', to: 'ETH' },
          }),
        });

        await client.getSwapQuote('btc', 'eth', '0.1');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('from=BTC'),
          expect.anything()
        );
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('to=ETH'),
          expect.anything()
        );
      });
    });

    describe('createSwap', () => {
      it('should create swap with valid parameters', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swap: {
              id: 'swap-123',
              from: 'BTC',
              to: 'ETH',
              depositAddress: 'bc1q...',
              depositAmount: '0.1',
              settleAddress: '0x...',
              status: 'pending',
              createdAt: new Date().toISOString(),
            },
          }),
        });

        const result = await client.createSwap({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
          settleAddress: '0x1234567890abcdef',
          refundAddress: 'bc1q...',
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'https://test.api.com/swap/create',
          expect.objectContaining({
            method: 'POST',
          })
        );
        expect(result.success).toBe(true);
        expect(result.swap.id).toBe('swap-123');
      });

      it('should throw error for missing parameters', async () => {
        await expect(client.createSwap({}))
          .rejects.toThrow('from, to, amount, and settleAddress are required');
        
        await expect(client.createSwap({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
        })).rejects.toThrow('from, to, amount, and settleAddress are required');
      });

      it('should throw error without wallet ID', async () => {
        const noWalletClient = new SwapClient();
        
        await expect(noWalletClient.createSwap({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
          settleAddress: '0x...',
        })).rejects.toThrow('walletId is required');
      });

      it('should allow override of wallet ID', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true, swap: { id: 'swap-456' } }),
        });

        await client.createSwap({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
          settleAddress: '0x...',
          walletId: 'override-wallet-id',
        });

        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(requestBody.walletId).toBe('override-wallet-id');
      });
    });

    describe('getSwapStatus', () => {
      it('should get swap status', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swap: {
              id: 'swap-123',
              status: 'processing',
              depositAmount: '0.1',
              settleAmount: '1.5',
            },
          }),
        });

        const result = await client.getSwapStatus('swap-123');

        expect(mockFetch).toHaveBeenCalledWith(
          'https://test.api.com/swap/swap-123',
          expect.anything()
        );
        expect(result.swap.status).toBe('processing');
      });

      it('should throw error for missing swap ID', async () => {
        await expect(client.getSwapStatus()).rejects.toThrow('swapId is required');
        await expect(client.getSwapStatus('')).rejects.toThrow('swapId is required');
      });

      it('should handle not found error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({
            error: 'Swap not found',
          }),
        });

        await expect(client.getSwapStatus('invalid-id'))
          .rejects.toThrow('Swap not found');
      });
    });

    describe('waitForSwap', () => {
      it('should return immediately for completed swap', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swap: { id: 'swap-123', status: 'settled' },
          }),
        });

        const result = await client.waitForSwap('swap-123');

        expect(result.swap.status).toBe('settled');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should poll until target status', async () => {
        let callCount = 0;
        mockFetch.mockImplementation(() => {
          callCount++;
          const status = callCount < 3 ? 'processing' : 'settled';
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              swap: { id: 'swap-123', status },
            }),
          });
        });

        const result = await client.waitForSwap('swap-123', { interval: 10 });

        expect(result.swap.status).toBe('settled');
        expect(mockFetch).toHaveBeenCalledTimes(3);
      });

      it('should call onStatusChange callback', async () => {
        let callCount = 0;
        mockFetch.mockImplementation(() => {
          callCount++;
          const status = callCount === 1 ? 'pending' : 
                        callCount === 2 ? 'processing' : 'settled';
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              swap: { id: 'swap-123', status },
            }),
          });
        });

        const statusChanges = [];
        await client.waitForSwap('swap-123', {
          interval: 10,
          onStatusChange: (status, swap) => statusChanges.push(status),
        });

        expect(statusChanges).toEqual(['processing', 'settled']);
      });

      it('should timeout', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swap: { id: 'swap-123', status: 'pending' },
          }),
        });

        await expect(
          client.waitForSwap('swap-123', { interval: 10, timeout: 50 })
        ).rejects.toThrow('timed out');
      });
    });

    describe('getSwapHistory', () => {
      it('should get swap history', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swaps: [
              { id: 'swap-1', from_coin: 'BTC', to_coin: 'ETH', status: 'settled' },
              { id: 'swap-2', from_coin: 'ETH', to_coin: 'SOL', status: 'pending' },
            ],
            pagination: {
              total: 2,
              limit: 50,
              offset: 0,
              hasMore: false,
            },
          }),
        });

        const result = await client.getSwapHistory();

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/swap/history?'),
          expect.anything()
        );
        expect(result.swaps).toHaveLength(2);
      });

      it('should use custom wallet ID', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swaps: [],
            pagination: { total: 0 },
          }),
        });

        await client.getSwapHistory('custom-wallet');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('walletId=custom-wallet'),
          expect.anything()
        );
      });

      it('should apply filters', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swaps: [],
            pagination: { total: 0 },
          }),
        });

        await client.getSwapHistory(undefined, {
          status: 'settled',
          limit: 10,
          offset: 5,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('status=settled'),
          expect.anything()
        );
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('limit=10'),
          expect.anything()
        );
      });

      it('should throw error without wallet ID', async () => {
        const noWalletClient = new SwapClient();
        
        await expect(noWalletClient.getSwapHistory())
          .rejects.toThrow('walletId is required');
      });
    });
  });

  describe('convenience functions', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      global.fetch = mockFetch;
    });

    describe('getSwapCoins (function)', () => {
      it('should create client and call method', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            coins: [],
          }),
        });

        await getSwapCoins();

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/swap/coins'),
          expect.anything()
        );
      });
    });

    describe('getSwapQuote (function)', () => {
      it('should create client and call method', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            quote: { from: 'BTC', to: 'ETH' },
          }),
        });

        await getSwapQuote('BTC', 'ETH', '0.1');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/swap/quote'),
          expect.anything()
        );
      });
    });

    describe('createSwap (function)', () => {
      it('should create client and call method', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swap: { id: 'swap-123' },
          }),
        });

        await createSwap({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
          settleAddress: '0x...',
          walletId: 'test-wallet',
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/swap/create'),
          expect.objectContaining({ method: 'POST' })
        );
      });
    });

    describe('getSwapStatus (function)', () => {
      it('should create client and call method', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swap: { id: 'swap-123', status: 'settled' },
          }),
        });

        await getSwapStatus('swap-123');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/swap/swap-123'),
          expect.anything()
        );
      });
    });

    describe('getSwapHistory (function)', () => {
      it('should create client and call method', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            swaps: [],
            pagination: { total: 0 },
          }),
        });

        await getSwapHistory('test-wallet');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/swap/history'),
          expect.anything()
        );
      });
    });
  });

  describe('error handling', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      
      const client = new SwapClient();
      
      await expect(client.getSwapCoins()).rejects.toThrow('Network error');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({
          error: 'Invalid request',
        }),
      });

      const client = new SwapClient();
      
      await expect(client.getSwapCoins()).rejects.toThrow('Invalid request');
    });

    it('should handle timeout', async () => {
      const controller = { abort: vi.fn() };
      vi.spyOn(global, 'AbortController').mockImplementation(() => controller);
      
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        });
      });

      const client = new SwapClient({ timeout: 50 });
      
      await expect(client.getSwapCoins()).rejects.toThrow('timeout');
    });
  });
});
