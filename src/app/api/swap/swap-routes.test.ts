import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getQuote } from './quote/route';
import { POST as createSwap } from './create/route';
import { GET as getStatus } from './[id]/route';
import { GET as getCoins } from './coins/route';
import { POST as saveDeposit } from './[id]/deposit/route';

// Mock Supabase
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ 
            data: { provider_data: {} }, 
            error: null 
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  })),
}));

// Mock the changenow module
vi.mock('@/lib/swap/changenow', () => ({
  getSwapQuote: vi.fn(),
  createSwap: vi.fn(),
  getSwapStatus: vi.fn(),
  isSwapSupported: vi.fn((coin: string) => {
    const supported = ['BTC', 'ETH', 'SOL', 'POL', 'USDC', 'USDT'];
    return supported.includes(coin);
  }),
  SWAP_SUPPORTED_COINS: ['BTC', 'ETH', 'SOL', 'POL', 'USDC', 'USDT'],
  CN_COIN_MAP: {
    'BTC': { ticker: 'btc', network: 'btc' },
    'ETH': { ticker: 'eth', network: 'eth' },
    'SOL': { ticker: 'sol', network: 'sol' },
    'POL': { ticker: 'matic', network: 'matic' },
    'USDC': { ticker: 'usdc', network: 'eth' },
    'USDT': { ticker: 'usdterc20', network: 'eth' },
  },
}));

import * as changenow from '@/lib/swap/changenow';

describe('Swap API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/swap/quote', () => {
    it('should return 400 if missing parameters', async () => {
      const request = new NextRequest('http://localhost/api/swap/quote');
      const response = await getQuote(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Missing required parameters');
    });

    it('should return 400 for unsupported source coin', async () => {
      const request = new NextRequest('http://localhost/api/swap/quote?from=SHIB&to=ETH&amount=100');
      const response = await getQuote(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Unsupported source coin');
    });

    it('should return 400 for unsupported destination coin', async () => {
      const request = new NextRequest('http://localhost/api/swap/quote?from=BTC&to=SHIB&amount=0.1');
      const response = await getQuote(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Unsupported destination coin');
    });

    it('should return 400 when swapping same coin', async () => {
      const request = new NextRequest('http://localhost/api/swap/quote?from=BTC&to=BTC&amount=0.1');
      const response = await getQuote(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Cannot swap a coin for itself');
    });

    it('should return 400 for invalid amount', async () => {
      const request = new NextRequest('http://localhost/api/swap/quote?from=BTC&to=ETH&amount=-1');
      const response = await getQuote(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid amount');
    });

    it('should return quote on success', async () => {
      vi.mocked(changenow.getSwapQuote).mockResolvedValueOnce({
        depositCoin: 'btc',
        depositNetwork: 'btc',
        settleCoin: 'eth',
        settleNetwork: 'eth',
        depositAmount: '0.1',
        settleAmount: '1.5',
        rate: '15',
        minAmount: 0.001,
      });

      const request = new NextRequest('http://localhost/api/swap/quote?from=BTC&to=ETH&amount=0.1');
      const response = await getQuote(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.quote.from).toBe('BTC');
      expect(data.quote.to).toBe('ETH');
      expect(data.quote.depositAmount).toBe('0.1');
      expect(data.quote.settleAmount).toBe('1.5');
    });

    it('should handle API errors', async () => {
      vi.mocked(changenow.getSwapQuote).mockRejectedValueOnce(new Error('API error'));

      const request = new NextRequest('http://localhost/api/swap/quote?from=BTC&to=ETH&amount=0.1');
      const response = await getQuote(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('API error');
    });
  });

  describe('POST /api/swap/create', () => {
    it('should return 400 if missing parameters', async () => {
      const request = new NextRequest('http://localhost/api/swap/create', {
        method: 'POST',
        body: JSON.stringify({ from: 'BTC' }),
      });
      const response = await createSwap(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Missing required parameters');
    });

    it('should return 400 for unsupported coin', async () => {
      const request = new NextRequest('http://localhost/api/swap/create', {
        method: 'POST',
        body: JSON.stringify({
          from: 'SHIB',
          to: 'ETH',
          amount: '100',
          settleAddress: '0xabc123def456',
          walletId: 'test-wallet-id',
        }),
      });
      const response = await createSwap(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Unsupported source coin');
    });

    it('should return 400 for invalid settle address', async () => {
      const request = new NextRequest('http://localhost/api/swap/create', {
        method: 'POST',
        body: JSON.stringify({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
          settleAddress: 'short',
          walletId: 'test-wallet-id',
        }),
      });
      const response = await createSwap(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid settle address');
    });

    it('should create swap on success', async () => {
      vi.mocked(changenow.createSwap).mockResolvedValueOnce({
        id: 'swap-123',
        depositAddress: 'bc1qtest...',
        depositCoin: 'btc',
        depositNetwork: 'btc',
        depositAmount: '0.1',
        settleCoin: 'eth',
        settleNetwork: 'eth',
        settleAddress: '0xabc123def456789',
        settleAmount: '',
        status: 'pending',
        createdAt: '2026-02-06T00:00:00Z',
      });

      const request = new NextRequest('http://localhost/api/swap/create', {
        method: 'POST',
        body: JSON.stringify({
          from: 'BTC',
          to: 'ETH',
          amount: '0.1',
          settleAddress: '0xabc123def456789',
          walletId: 'test-wallet-id',
        }),
      });
      const response = await createSwap(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.swap.id).toBe('swap-123');
      expect(data.swap.depositAddress).toBe('bc1qtest...');
      expect(data.swap.status).toBe('pending');
    });
  });

  describe('GET /api/swap/[id]', () => {
    it('should return swap status', async () => {
      vi.mocked(changenow.getSwapStatus).mockResolvedValueOnce({
        id: 'swap-123',
        depositAddress: 'bc1qtest...',
        depositCoin: 'btc',
        depositNetwork: 'btc',
        depositAmount: '0.1',
        settleCoin: 'eth',
        settleNetwork: 'eth',
        settleAddress: '0xabc...',
        settleAmount: '1.5',
        status: 'settled',
        createdAt: '2026-02-06T00:00:00Z',
      });

      const request = new NextRequest('http://localhost/api/swap/swap-123');
      const response = await getStatus(request, { params: Promise.resolve({ id: 'swap-123' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.swap.id).toBe('swap-123');
      expect(data.swap.status).toBe('settled');
    });

    it('should return 404 for non-existent swap', async () => {
      vi.mocked(changenow.getSwapStatus).mockRejectedValueOnce(new Error('not found'));

      const request = new NextRequest('http://localhost/api/swap/nonexistent');
      const response = await getStatus(request, { params: Promise.resolve({ id: 'nonexistent' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Swap not found');
    });
  });

  describe('GET /api/swap/coins', () => {
    it('should return list of supported coins', async () => {
      const response = await getCoins();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.coins).toBeInstanceOf(Array);
      expect(data.coins.length).toBeGreaterThan(0);
      expect(data.provider).toBe('changenow');
    });

    it('should include coin metadata', async () => {
      const response = await getCoins();
      const data = await response.json();

      const btc = data.coins.find((c: { symbol: string }) => c.symbol === 'BTC');
      expect(btc).toBeDefined();
      expect(btc.ticker).toBe('btc');
    });
  });

  describe('POST /api/swap/[id]/deposit', () => {
    it('should save deposit tx hash', async () => {
      const request = new NextRequest('http://localhost/api/swap/test123/deposit', {
        method: 'POST',
        body: JSON.stringify({ txHash: '0xabc123def456' }),
      });

      const response = await saveDeposit(request, { params: Promise.resolve({ id: 'test123' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should reject missing swap ID', async () => {
      const request = new NextRequest('http://localhost/api/swap//deposit', {
        method: 'POST',
        body: JSON.stringify({ txHash: '0xabc123def456' }),
      });

      const response = await saveDeposit(request, { params: Promise.resolve({ id: '' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing swap ID or transaction hash');
    });

    it('should reject missing tx hash', async () => {
      const request = new NextRequest('http://localhost/api/swap/test123/deposit', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await saveDeposit(request, { params: Promise.resolve({ id: 'test123' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing swap ID or transaction hash');
    });
  });
});
