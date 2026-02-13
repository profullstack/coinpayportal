import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase } = vi.hoisted(() => {
  const mockStripe = {
    transfers: {
      create: vi.fn().mockResolvedValue({
        id: 'tr_test123',
        amount: 4500,
        currency: 'usd',
        destination: 'acct_test123',
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
                releasable_amount: 4500,
                total_amount: 5000,
                merchant_id: 'merch_123',
                stripe_payment_intent_id: 'pi_test123',
                release_after: '2024-01-01T00:00:00Z',
                stripe_accounts: { stripe_account_id: 'acct_test123' },
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

describe('POST /api/stripe/escrow/release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockFromChain();
  });

  it('should release escrow funds successfully', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/release', {
      method: 'POST',
      body: JSON.stringify({
        escrowId: 'esc_123',
        reason: 'Work completed',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.transfer_id).toBe('tr_test123');
    expect(data.amount_transferred).toBe(4500);
    expect(data.destination_account).toBe('acct_test123');
  });

  it('should return 400 for missing escrowId', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/release', {
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

    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/release', {
      method: 'POST',
      body: JSON.stringify({ escrowId: 'nonexistent' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Escrow not found or not in funded status');
  });

  it('should return 400 when escrow not yet eligible for release', async () => {
    mockFromChain({
      stripe_escrows: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'esc_123',
                  releasable_amount: 4500,
                  release_after: '2099-12-31T00:00:00Z', // Future date
                  stripe_accounts: { stripe_account_id: 'acct_test123' },
                },
              }),
            }),
          }),
        }),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/release', {
      method: 'POST',
      body: JSON.stringify({ escrowId: 'esc_123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Escrow not yet eligible for release');
  });

  it('should handle Stripe transfer errors', async () => {
    mockStripe.transfers.create.mockRejectedValue(new Error('Transfer failed'));

    const request = new NextRequest('http://localhost:3000/api/stripe/escrow/release', {
      method: 'POST',
      body: JSON.stringify({ escrowId: 'esc_123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Transfer failed');
  });
});
