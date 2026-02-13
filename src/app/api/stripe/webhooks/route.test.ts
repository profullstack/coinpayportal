import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase } = vi.hoisted(() => {
  const mockStripe = {
    webhooks: {
      constructEvent: vi.fn(),
    },
    charges: {
      list: vi.fn(),
      retrieve: vi.fn(),
    },
    balanceTransactions: {
      retrieve: vi.fn(),
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
    stripe_transactions: {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
    stripe_escrows: {
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
    stripe_disputes: {
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
    },
    stripe_accounts: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { merchant_id: 'merch_123' } }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
    stripe_payouts: {
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
  };

  const merged = { ...defaults, ...overrides };
  mockSupabase.from.mockImplementation((table: string) => merged[table] || {});
}

describe('POST /api/stripe/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test123';
    mockFromChain();
  });

  it('should return 400 for invalid signature', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      body: 'invalid-body',
      headers: {
        'stripe-signature': 'invalid_sig',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Webhook signature verification failed');
  });

  it('should handle payment_intent.succeeded event', async () => {
    const paymentIntent = {
      id: 'pi_test123',
      amount: 5000,
      currency: 'usd',
      metadata: {
        merchant_id: 'merch_123',
        business_id: 'biz_123',
        escrow_mode: 'false',
        platform_fee_amount: '50',
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: paymentIntent },
    });

    mockStripe.charges.list.mockResolvedValue({
      data: [{
        id: 'ch_test123',
        balance_transaction: 'txn_test123',
      }],
    });

    mockStripe.balanceTransactions.retrieve.mockResolvedValue({ fee: 175 });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify(paymentIntent),
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
  });

  it('should handle account.updated event', async () => {
    const account = {
      id: 'acct_test123',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    };

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'account.updated',
      data: { object: account },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify(account),
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
  });

  it('should handle unrecognized event types gracefully', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'some.unknown.event',
      data: { object: {} },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      body: '{}',
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
  });

  it('should handle charge.dispute.created event', async () => {
    const dispute = {
      id: 'dp_test123',
      charge: 'ch_test123',
      amount: 5000,
      currency: 'usd',
      status: 'needs_response',
      reason: 'fraudulent',
      evidence_details: { due_by: 1700000000 },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'charge.dispute.created',
      data: { object: dispute },
    });

    mockStripe.charges.retrieve.mockResolvedValue({
      payment_intent: 'pi_test123',
    });

    mockFromChain({
      ...getDefaultChain(),
      stripe_transactions: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { merchant_id: 'merch_123' } }),
          }),
        }),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify(dispute),
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it('should handle payout.paid event', async () => {
    const payout = {
      id: 'po_test123',
      amount: 5000,
      currency: 'usd',
      status: 'paid',
      destination: 'acct_test123',
      arrival_date: 1700000000,
    };

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'payout.paid',
      data: { object: payout },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhooks', {
      method: 'POST',
      body: JSON.stringify(payout),
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
  });
});

function getDefaultChain() {
  return {
    stripe_transactions: {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
    stripe_escrows: {
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
    stripe_disputes: {
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
    },
    stripe_accounts: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { merchant_id: 'merch_123' } }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
    stripe_payouts: {
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
  };
}
