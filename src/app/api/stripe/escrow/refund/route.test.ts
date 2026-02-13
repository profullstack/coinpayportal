import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase } = vi.hoisted(() => {
  const mockStripe = {
    refunds: {
      create: vi.fn().mockResolvedValue({
        id: 're_test123',
        amount: 5000,
        status: 'succeeded',
      }),
    },
  };

  const mockSupabase = {
    from: vi.fn(),
  };

  return { mockStripe, mockSupabase };
});

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mockStripe),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

import { POST } from './route';

function mockFromChain(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    stripe_escrows: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'esc_123',
                total_amount: 5000,
                stripe_charge_id: 'ch_test123',
                merchant_id: 'merch_123',
                stripe_payment_intent_id: 'pi_test123',
              },
            }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
    merchants: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { did: 'did:key:z6Mk123' } }),
        }),
      }),
    },
    did_reputation_events: {
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
    },
  };

  const merged = { ...defaults, ...overrides };
  mockSupabase.from.mockImplementation((table: string) => merged[table] || {});
}

describe('POST /api/stripe/escrow/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockFromChain();
  });

  it('should refund escrow fully', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({
        escrowId: 'esc_123',
        reason: 'Customer requested refund',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.refund_id).toBe('re_test123');
    expect(data.amount_refunded).toBe(5000);
    expect(data.escrow_status).toBe('refunded');
  });

  it('should handle partial refund', async () => {
    mockStripe.refunds.create.mockResolvedValue({
      id: 're_partial123',
      amount: 2500,
      status: 'succeeded',
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({
        escrowId: 'esc_123',
        amount: 2500,
        reason: 'Partial refund',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.amount_refunded).toBe(2500);
    expect(data.escrow_status).toBe('partially_refunded');
  });

  it('should return 400 for missing escrowId', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('escrowId is required');
  });

  it('should return 404 when escrow not found', async () => {
    mockFromChain({
      stripe_escrows: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({ escrowId: 'nonexistent' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Escrow not found or not in funded status');
  });

  it('should return 400 when no charge ID found', async () => {
    mockFromChain({
      stripe_escrows: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'esc_123',
                  total_amount: 5000,
                  stripe_charge_id: null,
                },
              }),
            }),
          }),
        }),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({ escrowId: 'esc_123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('No charge ID found for escrow');
  });

  it('should return 400 when refund amount exceeds total', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({
        escrowId: 'esc_123',
        amount: 10000,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Refund amount cannot exceed total escrow amount');
  });

  it('should handle Stripe refund errors', async () => {
    mockStripe.refunds.create.mockRejectedValue(new Error('Refund failed'));

    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/refund', {
      method: 'POST',
      body: JSON.stringify({ escrowId: 'esc_123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Refund failed');
  });
});
