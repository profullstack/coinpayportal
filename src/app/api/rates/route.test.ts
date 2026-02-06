import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock the tatum rates module
vi.mock('@/lib/rates/tatum', () => ({
  getExchangeRate: vi.fn(),
  getMultipleRates: vi.fn(),
}));

import { getExchangeRate } from '@/lib/rates/tatum';

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'));
}

describe('GET /api/rates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('single coin', () => {
    it('should return rate for BTC', async () => {
      vi.mocked(getExchangeRate).mockResolvedValue(50000);

      const res = await GET(createRequest('http://localhost/api/rates?coin=btc'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.coin).toBe('BTC');
      expect(data.rate).toBe(50000);
      expect(getExchangeRate).toHaveBeenCalledWith('BTC', 'USD');
    });

    it('should return 1.0 for USDT (stablecoin)', async () => {
      const res = await GET(createRequest('http://localhost/api/rates?coin=USDT'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.coin).toBe('USDT');
      expect(data.rate).toBe(1.0);
      expect(getExchangeRate).not.toHaveBeenCalled();
    });

    it('should return 1.0 for USDC_ETH (stablecoin)', async () => {
      const res = await GET(createRequest('http://localhost/api/rates?coin=USDC_ETH'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.coin).toBe('USDC_ETH');
      expect(data.rate).toBe(1.0);
    });

    it('should handle rate fetch error', async () => {
      vi.mocked(getExchangeRate).mockRejectedValue(new Error('API error'));

      const res = await GET(createRequest('http://localhost/api/rates?coin=ETH'));
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toContain('API error');
    });
  });

  describe('multiple coins', () => {
    it('should return rates for multiple coins', async () => {
      vi.mocked(getExchangeRate)
        .mockResolvedValueOnce(50000) // BTC
        .mockResolvedValueOnce(3000);  // ETH

      const res = await GET(createRequest('http://localhost/api/rates?coins=BTC,ETH'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.rates.BTC).toBe(50000);
      expect(data.rates.ETH).toBe(3000);
    });

    it('should include stablecoins as 1.0', async () => {
      vi.mocked(getExchangeRate).mockResolvedValueOnce(50000);

      const res = await GET(createRequest('http://localhost/api/rates?coins=BTC,USDT'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.rates.BTC).toBe(50000);
      expect(data.rates.USDT).toBe(1.0);
    });

    it('should skip coins that fail', async () => {
      vi.mocked(getExchangeRate)
        .mockResolvedValueOnce(50000) // BTC succeeds
        .mockRejectedValueOnce(new Error('fail')); // ETH fails

      const res = await GET(createRequest('http://localhost/api/rates?coins=BTC,ETH'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.rates.BTC).toBe(50000);
      expect(data.rates.ETH).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('should return 400 when no parameters provided', async () => {
      const res = await GET(createRequest('http://localhost/api/rates'));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('coin or coins parameter');
    });
  });
});
