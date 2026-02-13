import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEscrowRecord, releaseEscrow } from './escrow';

const mockTransferCreate = vi.fn();
vi.mock('./client', () => ({
  getStripeClient: () => ({
    transfers: { create: mockTransferCreate },
  }),
}));

function createMockSupabase(overrides: Record<string, any> = {}) {
  const defaultChain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: overrides.data ?? null, error: overrides.error ?? null }),
  };
  return {
    from: vi.fn().mockReturnValue(defaultChain),
    _chain: defaultChain,
  } as any;
}

describe('Escrow', () => {
  beforeEach(() => {
    mockTransferCreate.mockReset();
  });

  describe('createEscrowRecord', () => {
    it('should insert escrow record with calculated releasable amount', async () => {
      const chain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'esc_1', releasable_amount: 9500 },
          error: null,
        }),
      };
      const supabase = { from: vi.fn().mockReturnValue(chain) } as any;

      const result = await createEscrowRecord(supabase, {
        merchantId: 'merch_1',
        stripePaymentIntentId: 'pi_123',
        totalAmount: 10000,
        platformFee: 100,
        stripeFee: 400,
        releaseAfterDays: 7,
      });

      expect(supabase.from).toHaveBeenCalledWith('stripe_escrows');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          merchant_id: 'merch_1',
          total_amount: 10000,
          releasable_amount: 9500,
          status: 'held',
        })
      );
      expect(result.id).toBe('esc_1');
    });
  });

  describe('releaseEscrow', () => {
    it('should transfer funds and update status', async () => {
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'esc_1', releasable_amount: 9500, merchant_id: 'merch_1' },
          error: null,
        }),
      };
      const updateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'esc_1', status: 'released' },
          error: null,
        }),
      };

      let callCount = 0;
      const supabase = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? selectChain : updateChain;
        }),
      } as any;

      mockTransferCreate.mockResolvedValue({ id: 'tr_123' });

      const result = await releaseEscrow(supabase, 'esc_1', 'acct_123');

      expect(mockTransferCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 9500,
          destination: 'acct_123',
        })
      );
      expect(result.escrow.status).toBe('released');
    });
  });
});
