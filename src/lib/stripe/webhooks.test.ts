import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebhookEvent } from './webhooks';

vi.mock('./client', () => ({
  getStripeClient: () => ({
    transfers: { create: vi.fn().mockResolvedValue({ id: 'tr_1' }) },
    webhooks: { constructEvent: vi.fn() },
  }),
}));

vi.mock('./escrow', () => ({
  createEscrowRecord: vi.fn().mockResolvedValue({ id: 'esc_1' }),
}));

vi.mock('./reputation', () => ({
  recordReputationEvent: vi.fn().mockResolvedValue({ id: 'evt_1' }),
}));

function createMockSupabase() {
  const chain = {
    from: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { merchant_id: 'merch_1', did: 'did:coinpay:123' }, error: null }),
  };
  chain.from = vi.fn().mockReturnValue(chain);
  return chain as any;
}

describe('Webhooks', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = createMockSupabase();
  });

  it('should handle payment_intent.succeeded', async () => {
    const result = await handleWebhookEvent(supabase, {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          amount: 5000,
          currency: 'usd',
          latest_charge: 'ch_123',
          metadata: {
            coinpay_merchant_id: 'merch_1',
            mode: 'gateway',
            platform_fee: '50',
          },
        },
      },
    } as any);

    expect(result.handled).toBe(true);
    expect(result.action).toBe('payment_recorded');
  });

  it('should handle charge.dispute.created', async () => {
    const result = await handleWebhookEvent(supabase, {
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_123',
          charge: 'ch_123',
          amount: 5000,
          currency: 'usd',
          status: 'needs_response',
          reason: 'fraudulent',
          evidence_details: { due_by: 1700000000 },
        },
      },
    } as any);

    expect(result.handled).toBe(true);
    expect(result.action).toBe('dispute_recorded');
  });

  it('should handle account.updated', async () => {
    const result = await handleWebhookEvent(supabase, {
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          country: 'US',
          email: 'test@test.com',
        },
      },
    } as any);

    expect(result.handled).toBe(true);
    expect(result.action).toBe('account_updated');
  });

  it('should handle payout.paid', async () => {
    const result = await handleWebhookEvent(supabase, {
      type: 'payout.paid',
      data: {
        object: {
          id: 'po_123',
          amount: 5000,
          currency: 'usd',
          status: 'paid',
          arrival_date: 1700000000,
        },
      },
    } as any);

    expect(result.handled).toBe(true);
    expect(result.action).toBe('payout_recorded');
  });

  it('should return handled=false for unknown events', async () => {
    const result = await handleWebhookEvent(supabase, {
      type: 'some.unknown.event',
      data: { object: {} },
    } as any);

    expect(result.handled).toBe(false);
  });
});
