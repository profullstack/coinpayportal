// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { safeFetch, markPaid } = vi.hoisted(() => ({ safeFetch: vi.fn(), markPaid: vi.fn() }));
vi.mock('@/lib/security/ssrf', () => ({ safeFetch, isBlockedAddress: () => false }));
vi.mock('./secret', () => ({ resolveWebhookSecret: () => 'whsec_test' }));
vi.mock('./retry-queue', () => ({ enqueueFailedDelivery: vi.fn() }));
vi.mock('@/lib/checkout/settle', () => ({ markCheckoutSessionPaidFromWebhook: markPaid }));

import { sendPaymentWebhook } from './service';

const META = {
  plan: 'pro',
  checkout_session_id: 'cs_abcdefghijklmnopqrstuvwx',
  customer_email: 'buyer@example.com',
  account_id: 'user_1',
  property: 'example.com',
};

function supabase(paymentMetadata: unknown) {
  return {
    from: (table: string) => {
      if (table === 'businesses') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { webhook_url: 'https://hook.example/cp', webhook_secret: 'enc', merchant_id: 'm' }, error: null }) }) }) };
      }
      if (table === 'payments' || table === 'paypal_transactions') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'payments' ? { metadata: paymentMetadata } : null }) }) }) };
      }
      if (table === 'webhook_logs') return { insert: async () => ({ error: null }) };
      throw new Error(table);
    },
  } as any;
}

beforeEach(() => {
  safeFetch.mockReset();
  markPaid.mockReset().mockResolvedValue(true);
  safeFetch.mockResolvedValue({ ok: true, response: { ok: true, status: 200 } });
});

describe('payment webhooks carry who paid and for which property', () => {
  it('adds checkout_session_id, customer_email, account_id, property and keeps the nested shape', async () => {
    await sendPaymentWebhook(supabase(null), 'biz', 'pay-1', 'payment.confirmed', {
      status: 'confirmed', amount_usd: '9.99', currency: 'USDC_POL', blockchain: 'USDC_POL', metadata: META,
    });
    const body = JSON.parse(safeFetch.mock.calls[0][1].body);
    expect(body.type).toBe('payment.confirmed');
    expect(body.id).toMatch(/^evt_pay-1_/);
    expect(body.data).toMatchObject({
      payment_id: 'pay-1',
      status: 'confirmed',
      amount: '9.99',
      checkout_session_id: META.checkout_session_id,
      customer_email: 'buyer@example.com',
      account_id: 'user_1',
      property: 'example.com',
      metadata: META,
    });
    expect(markPaid).toHaveBeenCalledWith(expect.anything(), { sessionId: META.checkout_session_id, paymentId: 'pay-1', method: 'USDC_POL', businessId: 'biz' });
  });

  it('loads metadata off the payment row when the confirm path did not pass it', async () => {
    await sendPaymentWebhook(supabase(META), 'biz', 'pay-2', 'payment.confirmed', { status: 'confirmed' });
    const body = JSON.parse(safeFetch.mock.calls[0][1].body);
    expect(body.data.account_id).toBe('user_1');
    expect(body.data.metadata).toEqual(META);
  });

  it('leaves a plain payment unchanged', async () => {
    await sendPaymentWebhook(supabase({ order: 1 }), 'biz', 'pay-3', 'payment.confirmed', { status: 'confirmed', metadata: { order: 1 } });
    const body = JSON.parse(safeFetch.mock.calls[0][1].body);
    expect(body.data).not.toHaveProperty('checkout_session_id');
    expect(body.data).not.toHaveProperty('customer_email');
    expect(markPaid).not.toHaveBeenCalled();
  });
});
