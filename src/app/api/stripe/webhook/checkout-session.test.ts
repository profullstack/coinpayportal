import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase, mockSendPaymentWebhook } = vi.hoisted(() => {
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

  const mockSendPaymentWebhook = vi.fn().mockResolvedValue({ success: true });

  return { mockStripe, mockSupabase, mockSendPaymentWebhook };
});

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mockStripe),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

vi.mock('@/lib/webhooks/service', () => ({
  sendPaymentWebhook: mockSendPaymentWebhook,
}));

import { POST } from './route';

function setupMockChain(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    payments: {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'pay_123',
                  business_id: 'biz_123',
                  amount: '100.00',
                  status: 'confirmed',
                  metadata: { payment_method: 'both' },
                },
              }),
            }),
          }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'pay_123',
              business_id: 'biz_123',
              amount: '100.00',
              status: 'pending',
              metadata: { payment_method: 'both', stripe_checkout_url: 'https://...' },
            },
          }),
        }),
      }),
    },
    stripe_transactions: {
      upsert: vi.fn().mockResolvedValue({ data: [{}] }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
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

describe('Stripe Webhook - checkout.session.completed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test123';
    setupMockChain();
  });

  it('should handle checkout.session.completed and fire merchant webhook', async () => {
    const session = {
      id: 'cs_test_123',
      payment_intent: 'pi_test_456',
      amount_total: 10000,
      currency: 'usd',
      metadata: {
        coinpay_payment_id: 'pay_123',
        business_id: 'biz_123',
        merchant_id: 'merch_123',
        platform_fee_amount: '100',
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(session),
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);

    // Verify merchant webhook was fired
    expect(mockSendPaymentWebhook).toHaveBeenCalledTimes(1);
    expect(mockSendPaymentWebhook).toHaveBeenCalledWith(
      expect.anything(), // supabase client
      'biz_123',
      'pay_123',
      'payment.confirmed',
      expect.objectContaining({
        status: 'confirmed',
        tx_hash: 'pi_test_456',
        metadata: expect.objectContaining({
          payment_rail: 'card',
          stripe_session_id: 'cs_test_123',
        }),
      })
    );
  });

  it('should skip checkout.session.completed without coinpay_payment_id', async () => {
    const session = {
      id: 'cs_external_123',
      payment_intent: 'pi_ext_456',
      amount_total: 5000,
      currency: 'usd',
      metadata: {
        // No coinpay_payment_id
        some_other_field: 'value',
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(session),
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    // Should NOT fire merchant webhook
    expect(mockSendPaymentWebhook).not.toHaveBeenCalled();
  });

  it('should still handle payment_intent.succeeded events', async () => {
    const paymentIntent = {
      id: 'pi_test789',
      amount: 5000,
      currency: 'usd',
      metadata: {
        merchant_id: 'merch_123',
        business_id: 'biz_123',
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

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(paymentIntent),
      headers: {
        'stripe-signature': 'valid_sig',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});
