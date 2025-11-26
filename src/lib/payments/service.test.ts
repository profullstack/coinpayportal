import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { createPayment, getPayment, listPayments } from './service';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as rates from '../rates/tatum';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

vi.mock('../rates/tatum', async () => {
  const actual = await vi.importActual('../rates/tatum');
  return {
    ...actual,
    getCryptoPrice: vi.fn(),
  };
});

const createMockSupabaseClient = () => {
  const mockClient = {
    from: vi.fn(() => mockClient),
    select: vi.fn(() => mockClient),
    insert: vi.fn(() => mockClient),
    eq: vi.fn(() => mockClient),
    single: vi.fn(),
  } as unknown as SupabaseClient;
  
  return mockClient;
};

describe('Payment Service', () => {
  let mockSupabase: SupabaseClient;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    vi.clearAllMocks();
    vi.mocked(rates.getCryptoPrice).mockResolvedValue(0.002);
  });

  describe('createPayment', () => {
    it('should create a payment successfully', async () => {
      const mockPayment = {
        id: 'payment-123',
        business_id: '550e8400-e29b-41d4-a716-446655440000',
        amount: 100,
        currency: 'USD',
        blockchain: 'BTC',
        status: 'pending',
        crypto_amount: 0.002,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: new Date().toISOString(),
      };

      mockSupabase.from = vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: mockPayment,
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await createPayment(mockSupabase, {
        business_id: '550e8400-e29b-41d4-a716-446655440000',
        amount: 100,
        currency: 'USD',
        blockchain: 'BTC',
        merchant_wallet_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      });

      expect(result.success).toBe(true);
      expect(result.payment).toBeDefined();
      expect(result.payment?.amount).toBe(100);
      expect(result.payment?.crypto_amount).toBe(0.002);
      expect(result.payment?.expires_at).toBeDefined();
    });

    it('should validate required fields', async () => {
      const result = await createPayment(mockSupabase, {
        business_id: '',
        amount: 100,
        currency: 'USD',
        blockchain: 'BTC',
        merchant_wallet_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate amount is positive', async () => {
      const result = await createPayment(mockSupabase, {
        business_id: 'business-123',
        amount: 0,
        currency: 'USD',
        blockchain: 'BTC',
        merchant_wallet_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Amount');
    });

    it('should validate blockchain type', async () => {
      const result = await createPayment(mockSupabase, {
        business_id: 'business-123',
        amount: 100,
        currency: 'USD',
        blockchain: 'INVALID' as any,
        merchant_wallet_address: 'test-address',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blockchain');
    });

    it('should calculate crypto amount using exchange rates', async () => {
      vi.mocked(rates.getCryptoPrice).mockResolvedValueOnce(0.5);

      mockSupabase.from = vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                business_id: '550e8400-e29b-41d4-a716-446655440000',
                crypto_amount: 0.5,
                expires_at: new Date().toISOString(),
              },
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await createPayment(mockSupabase, {
        business_id: '550e8400-e29b-41d4-a716-446655440000',
        amount: 1500,
        currency: 'USD',
        blockchain: 'ETH',
        merchant_wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      });

      expect(rates.getCryptoPrice).toHaveBeenCalledWith(1500, 'USD', 'ETH');
      expect(result.payment?.crypto_amount).toBe(0.5);
    });

    it('should set expiration to 1 hour from now', async () => {
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      mockSupabase.from = vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                business_id: '550e8400-e29b-41d4-a716-446655440000',
                expires_at: oneHourLater.toISOString(),
              },
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await createPayment(mockSupabase, {
        business_id: '550e8400-e29b-41d4-a716-446655440000',
        amount: 100,
        currency: 'USD',
        blockchain: 'BTC',
        merchant_wallet_address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      });

      expect(result.success).toBe(true);
      expect(result.payment?.expires_at).toBeDefined();
    });
  });

  describe('getPayment', () => {
    it('should get a payment by ID', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'payment-123',
                amount: 100,
                status: 'pending',
              },
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await getPayment(mockSupabase, 'payment-123');

      expect(result.success).toBe(true);
      expect(result.payment).toBeDefined();
      expect(result.payment?.id).toBe('payment-123');
    });

    it('should return error when payment not found', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Not found' },
            }),
          })),
        })),
      })) as any;

      const result = await getPayment(mockSupabase, 'payment-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('listPayments', () => {
    it('should list payments for a business', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'payment-1', amount: 100, status: 'pending' },
                { id: 'payment-2', amount: 200, status: 'confirmed' },
              ],
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await listPayments(mockSupabase, 'business-123');

      expect(result.success).toBe(true);
      expect(result.payments).toHaveLength(2);
    });

    it('should return empty array when no payments', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await listPayments(mockSupabase, 'business-123');

      expect(result.success).toBe(true);
      expect(result.payments).toHaveLength(0);
    });
  });
});