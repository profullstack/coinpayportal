import { describe, it, expect, vi } from 'vitest';
import { recordReputationEvent, getCardReputationSummary } from './reputation';

describe('Reputation', () => {
  describe('recordReputationEvent', () => {
    it('should insert a reputation event with correct weight', async () => {
      const chain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'evt_1', weight: -5 },
          error: null,
        }),
      };
      const supabase = { from: vi.fn().mockReturnValue(chain) } as any;

      const result = await recordReputationEvent(supabase, {
        did: 'did:coinpay:123',
        eventType: 'card_dispute_created',
        relatedTransactionId: 'pi_123',
      });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          did: 'did:coinpay:123',
          event_type: 'card_dispute_created',
          source_rail: 'card',
          weight: -5,
        })
      );
      expect(result.weight).toBe(-5);
    });

    it('should use weight 1 for successful payment', async () => {
      const chain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'evt_2', weight: 1 },
          error: null,
        }),
      };
      const supabase = { from: vi.fn().mockReturnValue(chain) } as any;

      await recordReputationEvent(supabase, {
        did: 'did:coinpay:123',
        eventType: 'card_payment_success',
      });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 1 })
      );
    });
  });

  describe('getCardReputationSummary', () => {
    it('should summarize reputation events', async () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      // Last eq call returns promise
      let eqCount = 0;
      chain.eq = vi.fn().mockImplementation(() => {
        eqCount++;
        if (eqCount >= 2) {
          return Promise.resolve({
            data: [
              { event_type: 'card_payment_success', weight: 1 },
              { event_type: 'card_payment_success', weight: 1 },
              { event_type: 'card_refund', weight: -2 },
              { event_type: 'card_dispute_created', weight: -5 },
            ],
            error: null,
          });
        }
        return chain;
      });

      const supabase = { from: vi.fn().mockReturnValue(chain) } as any;
      const summary = await getCardReputationSummary(supabase, 'did:coinpay:123');

      expect(summary.successful_payments).toBe(2);
      expect(summary.refunds).toBe(1);
      expect(summary.disputes).toBe(1);
      expect(summary.total_score).toBe(-5); // 1+1-2-5
      expect(summary.dispute_ratio).toBeCloseTo(1 / 3);
      expect(summary.refund_ratio).toBeCloseTo(1 / 3);
    });
  });
});
