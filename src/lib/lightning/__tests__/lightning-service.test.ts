import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LightningService } from '../lightning-service';

// ──────────────────────────────────────────────
// Mock Supabase
// ──────────────────────────────────────────────

const mockSingle = vi.fn();
const mockSubscribe = vi.fn().mockReturnValue({ id: 'channel-1' });
const mockOn = vi.fn().mockReturnValue({ subscribe: mockSubscribe });

const mockChain: any = {};
['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'range'].forEach((m) => {
  mockChain[m] = vi.fn().mockReturnValue(mockChain);
});
mockChain.single = mockSingle;
mockChain.maybeSingle = vi.fn().mockReturnValue(mockChain);

// For listOffers/listPayments — chain needs count support
let mockCount: number | null = 0;
let mockData: any[] | null = [];
let mockError: any = null;

// Override select to capture count option and return chain
const originalSelect = mockChain.select;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => mockChain),
    channel: vi.fn(() => ({ on: mockOn })),
    removeChannel: vi.fn(),
  })),
}));

// ──────────────────────────────────────────────
// deriveLnNodeKeys
// ──────────────────────────────────────────────


// ──────────────────────────────────────────────
// LightningService
// ──────────────────────────────────────────────

describe('LightningService', () => {
  let service: LightningService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    service = new LightningService();
  });

  // ──────────────────────────────────────────
  // provisionNode
  // ──────────────────────────────────────────



  describe('getPaymentStatus', () => {
    it('should return payment when found', async () => {
      const fakePayment = {
        id: 'pay-1',
        payment_hash: 'abc123',
        status: 'settled',
        amount_msat: 100000,
      };
      mockSingle.mockResolvedValue({ data: fakePayment, error: null });

      const result = await service.getPaymentStatus('abc123');
      expect(result).toEqual(fakePayment);
      expect(mockChain.eq).toHaveBeenCalledWith('payment_hash', 'abc123');
    });

    it('should return null when not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const result = await service.getPaymentStatus('nonexistent');
      expect(result).toBeNull();
    });

    it('should return payment with pending status', async () => {
      const fakePayment = {
        id: 'pay-2',
        payment_hash: 'def456',
        status: 'pending',
        amount_msat: 50000,
      };
      mockSingle.mockResolvedValue({ data: fakePayment, error: null });

      const result = await service.getPaymentStatus('def456');
      expect(result?.status).toBe('pending');
    });

    it('should return payment with failed status', async () => {
      const fakePayment = {
        id: 'pay-3',
        payment_hash: 'ghi789',
        status: 'failed',
        amount_msat: 75000,
      };
      mockSingle.mockResolvedValue({ data: fakePayment, error: null });

      const result = await service.getPaymentStatus('ghi789');
      expect(result?.status).toBe('failed');
    });
  });

  // ──────────────────────────────────────────
  // listPayments
  // ──────────────────────────────────────────

  describe('listPayments', () => {
    it('should list payments with default pagination', async () => {
      // For non-single queries, mock the chain resolution
      Object.defineProperty(mockChain, 'then', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      // listPayments doesn't call .single(), it awaits the query directly
      // We need to make the chain resolve when awaited
      mockChain.range = vi.fn().mockResolvedValue({
        data: [{ id: 'p1' }, { id: 'p2' }],
        error: null,
        count: 2,
      });

      const result = await service.listPayments({});
      expect(result.payments).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by node_id', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: [{ id: 'p1', node_id: 'n1' }],
        error: null,
        count: 1,
      });

      const result = await service.listPayments({ node_id: 'n1' });
      expect(mockChain.eq).toHaveBeenCalledWith('node_id', 'n1');
      expect(result.payments).toHaveLength(1);
    });

    it('should filter by business_id and offer_id', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      const result = await service.listPayments({
        business_id: 'b1',
        offer_id: 'o1',
      });
      expect(result.payments).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should apply pagination', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: [{ id: 'p3' }],
        error: null,
        count: 10,
      });

      await service.listPayments({ limit: 1, offset: 2 });
      expect(mockChain.range).toHaveBeenCalledWith(2, 2);
    });

    it('should throw on query error', async () => {
      mockChain.range = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'query failed' },
        count: null,
      });

      await expect(service.listPayments({})).rejects.toThrow(
        'Failed to list payments: query failed'
      );
    });
  });
});
