import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getSideshiftClient, 
  getSwapQuote, 
  createSwap, 
  getSwapStatus,
} from './sideshift';
import { COIN_NETWORK_MAP } from './types';
import { QuoteResponse, ShiftResponse } from './types';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SideShift Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('COIN_NETWORK_MAP', () => {
    it('should have mappings for all supported coins', () => {
      expect(COIN_NETWORK_MAP['BTC']).toEqual({ coin: 'btc', network: 'bitcoin' });
      expect(COIN_NETWORK_MAP['ETH']).toEqual({ coin: 'eth', network: 'ethereum' });
      expect(COIN_NETWORK_MAP['SOL']).toEqual({ coin: 'sol', network: 'solana' });
      expect(COIN_NETWORK_MAP['POL']).toEqual({ coin: 'matic', network: 'polygon' });
      expect(COIN_NETWORK_MAP['BCH']).toEqual({ coin: 'bch', network: 'bitcoincash' });
      expect(COIN_NETWORK_MAP['USDC']).toEqual({ coin: 'usdc', network: 'ethereum' });
    });
  });

  describe('getSwapQuote', () => {
    it('should get a quote for BTC to ETH swap', async () => {
      const mockQuote: QuoteResponse = {
        id: 'quote-123',
        createdAt: '2026-02-06T00:00:00Z',
        depositCoin: 'btc',
        depositNetwork: 'bitcoin',
        settleCoin: 'eth',
        settleNetwork: 'ethereum',
        depositAmount: '0.01',
        settleAmount: '0.15',
        rate: '15.0',
        expiresAt: '2026-02-06T00:15:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const quote = await getSwapQuote({
        from: 'BTC',
        to: 'ETH',
        amount: '0.01',
      });

      expect(quote.id).toBe('quote-123');
      expect(quote.depositAmount).toBe('0.01');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://sideshift.ai/api/v2/quotes',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw for unsupported coin pair', async () => {
      await expect(
        getSwapQuote({
          from: 'DOGE',
          to: 'ETH',
          amount: '100',
        })
      ).rejects.toThrow('Unsupported coin pair');
    });
  });

  describe('createSwap', () => {
    it('should create a shift', async () => {
      const mockShift: ShiftResponse = {
        id: 'shift-456',
        createdAt: '2026-02-06T00:00:00Z',
        depositCoin: 'btc',
        depositNetwork: 'bitcoin',
        depositAddress: 'bc1qtest...',
        depositMin: '0.0001',
        depositMax: '1.0',
        depositAmount: '0.01',
        settleCoin: 'eth',
        settleNetwork: 'ethereum',
        settleAddress: '0xabc...',
        settleAmount: '0.15',
        status: 'pending',
        expiresAt: '2026-02-06T00:30:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockShift),
      });

      const shift = await createSwap({
        quoteId: 'quote-123',
        settleAddress: '0xabc...',
      });

      expect(shift.id).toBe('shift-456');
      expect(shift.status).toBe('pending');
      expect(shift.depositAddress).toBe('bc1qtest...');
    });
  });

  describe('getSwapStatus', () => {
    it('should get shift status', async () => {
      const mockShift: ShiftResponse = {
        id: 'shift-456',
        createdAt: '2026-02-06T00:00:00Z',
        depositCoin: 'btc',
        depositNetwork: 'bitcoin',
        depositAddress: 'bc1qtest...',
        depositMin: '0.0001',
        depositMax: '1.0',
        depositAmount: '0.01',
        settleCoin: 'eth',
        settleNetwork: 'ethereum',
        settleAddress: '0xabc...',
        settleAmount: '0.15',
        status: 'settled',
        expiresAt: '2026-02-06T00:30:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockShift),
      });

      const status = await getSwapStatus('shift-456');

      expect(status.status).toBe('settled');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://sideshift.ai/api/v2/shifts/shift-456',
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'Invalid amount' } }),
      });

      await expect(
        getSwapQuote({
          from: 'BTC',
          to: 'ETH',
          amount: '0.00001',
        })
      ).rejects.toThrow('Invalid amount');
    });
  });
});
