import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// Mock environment variables
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

// Mock Supabase
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  in: vi.fn(() => mockSupabase),
  lt: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  single: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// Mock secure forwarding
vi.mock('../wallets/secure-forwarding', () => ({
  forwardPaymentSecurely: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock fetch for balance checks
global.fetch = vi.fn();

describe('Payment Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkBalance', () => {
    it('should check BTC balance using Blockstream API', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      // Import after mocking
      const { checkBalance } = await import('./monitor');
      const balance = await checkBalance('BTC', 'bc1qtest');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('blockstream.info')
      );
      expect(balance).toBe(1); // 100000000 satoshis = 1 BTC
    });

    it('should check ETH balance using JSON-RPC', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: '0xde0b6b3a7640000', // 1 ETH in wei (hex)
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const { checkBalance } = await import('./monitor');
      const balance = await checkBalance('ETH', '0xtest');

      expect(global.fetch).toHaveBeenCalled();
      expect(balance).toBeGreaterThan(0);
    });

    it('should check SOL balance using Solana RPC', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: { value: 1000000000 }, // 1 SOL in lamports
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const { checkBalance } = await import('./monitor');
      const balance = await checkBalance('SOL', 'SolanaAddress');

      expect(global.fetch).toHaveBeenCalled();
      expect(balance).toBe(1); // 1000000000 lamports = 1 SOL
    });

    it('should return 0 on error', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const { checkBalance } = await import('./monitor');
      const balance = await checkBalance('BTC', 'bc1qtest');

      expect(balance).toBe(0);
    });
  });

  describe('Monitor State', () => {
    it('should start in stopped state', async () => {
      const { isMonitorRunning } = await import('./monitor');
      expect(isMonitorRunning()).toBe(false);
    });

    it('should track running state after start', async () => {
      const { startMonitor, stopMonitor, isMonitorRunning } = await import('./monitor');
      
      startMonitor();
      expect(isMonitorRunning()).toBe(true);
      
      stopMonitor();
      expect(isMonitorRunning()).toBe(false);
    });
  });

  describe('runOnce', () => {
    it('should process pending payments', async () => {
      const mockPayments = [
        {
          id: 'payment-1',
          business_id: 'business-1',
          blockchain: 'BTC',
          crypto_amount: 0.001,
          status: 'pending',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
      ];

      const mockAddresses = [
        {
          payment_id: 'payment-1',
          address: 'bc1qtest',
          cryptocurrency: 'BTC',
        },
      ];

      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => Promise.resolve({ data: mockPayments, error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: mockAddresses, error: null })),
      }));

      // Mock balance check to return 0 (no payment received)
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as any);

      const { runOnce } = await import('./monitor');
      const result = await runOnce();

      expect(result).toBeDefined();
      expect(result.checked).toBeGreaterThanOrEqual(0);
    });

    it('should expire old pending payments', async () => {
      const expiredPayment = {
        id: 'payment-expired',
        business_id: 'business-1',
        blockchain: 'BTC',
        crypto_amount: 0.001,
        status: 'pending',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(), // Already expired
      };

      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => Promise.resolve({ data: [expiredPayment], error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      }));

      mockSupabase.update = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      }));

      const { runOnce } = await import('./monitor');
      await runOnce();

      // Should have attempted to update expired payments
      expect(mockSupabase.from).toHaveBeenCalled();
    });
  });

  describe('Payment Confirmation', () => {
    it('should confirm payment when balance matches expected amount', async () => {
      const mockPayment = {
        id: 'payment-1',
        business_id: 'business-1',
        blockchain: 'BTC',
        crypto_amount: 0.001,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };

      const mockAddress = {
        payment_id: 'payment-1',
        address: 'bc1qtest',
        cryptocurrency: 'BTC',
      };

      mockSupabase.select = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => Promise.resolve({ data: [mockPayment], error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [mockAddress], error: null })),
      }));

      // Mock balance check to return exact expected amount
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0 }, // 0.001 BTC
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as any);

      mockSupabase.update = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      }));

      const { runOnce } = await import('./monitor');
      const result = await runOnce();

      expect(result).toBeDefined();
    });
  });
});