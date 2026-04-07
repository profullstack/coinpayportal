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

  it('should handle checkout.session.completed for invoice payments', async () => {
    const invoiceData = {
      id: 'inv_123',
      invoice_number: 'INV-001',
      amount: '100.00',
      currency: 'USD',
      status: 'sent',
      metadata: {},
      businesses: { id: 'biz_123', name: 'Acme', merchant_id: 'merch_123' },
    };

    setupMockChain({
      invoices: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: invoiceData, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{}] }),
        }),
      },
    });

    const session = {
      id: 'cs_inv_123',
      payment_intent: 'pi_inv_456',
      amount_total: 10000,
      currency: 'usd',
      metadata: {
        coinpay_invoice_id: 'inv_123',
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
      headers: { 'stripe-signature': 'valid_sig' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);

    // Verify merchant webhook was fired with invoice.paid event
    expect(mockSendPaymentWebhook).toHaveBeenCalledTimes(1);
    expect(mockSendPaymentWebhook).toHaveBeenCalledWith(
      expect.anything(),
      'biz_123',
      'inv_123',
      'invoice.paid',
      expect.objectContaining({
        status: 'paid',
        payment_rail: 'card',
        invoice_number: 'INV-001',
      })
    );
  });

  it('upserts stripe_transactions row WITH business_id (regression: dashboard was empty)', async () => {
    const session = {
      id: 'cs_dashboard_1',
      payment_intent: 'pi_dashboard_1',
      amount_total: 10000,
      currency: 'usd',
      metadata: {
        coinpay_payment_id: 'pay_dash',
        business_id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
        merchant_id: 'merch_d0rz',
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
      headers: { 'stripe-signature': 'valid_sig' },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // The dashboard query at /api/stripe/transactions filters by business_id,
    // so business_id MUST be set on the upserted row. This was the bug.
    const txTable = mockSupabase.from.mock.results
      .map((r: any) => r.value)
      .find((v: any) => v && v.upsert);
    expect(txTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
        merchant_id: 'merch_d0rz',
        amount: 10000,
        status: 'completed',
        rail: 'card',
        stripe_payment_intent_id: 'pi_dashboard_1',
        platform_fee_amount: 100,
        net_to_merchant: 9900,
      }),
      { onConflict: 'stripe_payment_intent_id' }
    );
  });

  it('forwards a payment.confirmed webhook to the merchant on checkout.session.completed', async () => {
    const session = {
      id: 'cs_fwd_1',
      payment_intent: 'pi_fwd_1',
      amount_total: 10000,
      currency: 'usd',
      metadata: {
        coinpay_payment_id: 'pay_dash',
        business_id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
        merchant_id: 'merch_d0rz',
        platform_fee_amount: '100',
      },
    };
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    });

    await POST(new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(session),
      headers: { 'stripe-signature': 'valid_sig' },
    }));

    expect(mockSendPaymentWebhook).toHaveBeenCalledWith(
      expect.anything(),
      'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
      'pay_dash',
      'payment.confirmed',
      expect.objectContaining({
        status: 'confirmed',
        tx_hash: 'pi_fwd_1',
        metadata: expect.objectContaining({
          payment_rail: 'card',
          stripe_payment_intent_id: 'pi_fwd_1',
        }),
      })
    );
  });

  it('forwards payment.failed webhook on payment_intent.payment_failed', async () => {
    const paymentIntent = {
      id: 'pi_failed_1',
      amount: 1000,
      currency: 'usd',
      last_payment_error: { message: 'Your card was declined.' },
      metadata: {
        coinpay_payment_id: 'pay_failed',
        business_id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
        merchant_id: 'merch_d0rz',
      },
    };
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: paymentIntent },
    });

    await POST(new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(paymentIntent),
      headers: { 'stripe-signature': 'valid_sig' },
    }));

    expect(mockSendPaymentWebhook).toHaveBeenCalledWith(
      expect.anything(),
      'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
      'pay_failed',
      'payment.failed',
      expect.objectContaining({
        status: 'failed',
        tx_hash: 'pi_failed_1',
        metadata: expect.objectContaining({
          payment_rail: 'card',
          failure_message: 'Your card was declined.',
        }),
      })
    );
  });

  it('payment_intent.succeeded upserts WITH business_id', async () => {
    const paymentIntent = {
      id: 'pi_pi_succ_1',
      amount: 5000,
      currency: 'usd',
      metadata: {
        merchant_id: 'merch_d0rz',
        business_id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
        platform_fee_amount: '50',
      },
    };
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: paymentIntent },
    });
    mockStripe.charges.list.mockResolvedValue({
      data: [{ id: 'ch_x', balance_transaction: 'txn_x' }],
    });
    mockStripe.balanceTransactions.retrieve.mockResolvedValue({ fee: 175 });

    await POST(new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify(paymentIntent),
      headers: { 'stripe-signature': 'valid_sig' },
    }));

    const txTable = mockSupabase.from.mock.results
      .map((r: any) => r.value)
      .find((v: any) => v && v.upsert);
    expect(txTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
        merchant_id: 'merch_d0rz',
        stripe_payment_intent_id: 'pi_pi_succ_1',
        stripe_charge_id: 'ch_x',
        stripe_fee_amount: 175,
        platform_fee_amount: 50,
        net_to_merchant: 5000 - 175 - 50,
        status: 'completed',
      }),
      { onConflict: 'stripe_payment_intent_id' }
    );
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
