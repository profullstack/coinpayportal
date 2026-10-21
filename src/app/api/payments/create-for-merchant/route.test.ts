// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { createPaypal, createPaymentMock } = vi.hoisted(() => ({
  createPaypal: vi.fn(),
  createPaymentMock: vi.fn(),
}));

const MERCHANT = '11111111-2222-3333-4444-555555555555';
let paypalConnected = true;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (table === 'reputation_issuers') return { data: { did: 'did:web:bl0ggers.com', name: 'bl0ggers' } };
          if (table === 'merchant_wallets') return { data: { wallet_address: '0xseller' } };
          return { data: null };
        },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'businesses') return resolve({ data: [{ id: 'biz-old' }, { id: 'biz-pp' }] });
          if (table === 'paypal_accounts') return resolve({ data: paypalConnected ? [{ business_id: 'biz-pp' }] : [] });
          return resolve({ data: [] });
        },
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/p2p/platform-ownership', () => ({ platformMayManageMerchant: async () => ({ ok: true }) }));
vi.mock('@/lib/paypal/create-payment', () => ({ createPaypalPaymentForBusiness: createPaypal }));
vi.mock('@/lib/payments/service', () => ({ createPayment: createPaymentMock }));

import { POST } from './route';

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/payments/create-for-merchant', {
    method: 'POST',
    headers: { authorization: 'Bearer issuer-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk';
  paypalConnected = true;
  createPaypal.mockReset().mockResolvedValue({
    ok: true,
    response: {
      transaction_id: 'tx-1',
      order_id: 'ORDER1',
      approve_url: 'https://www.paypal.com/checkoutnow?token=ORDER1',
      checkout_url: 'https://coinpayportal.com/pay/paypal/tx-1',
      amount: 12.5,
    },
  });
  createPaymentMock.mockReset().mockResolvedValue({
    success: true,
    payment: { id: 'pay-1', payment_address: '0xdep', crypto_amount: 0.01, expires_at: 'x' },
  });
});

describe('POST /api/payments/create-for-merchant', () => {
  it('opens a PayPal order on the seller business that has PayPal connected', async () => {
    const res = await POST(req({
      merchant_id: MERCHANT,
      amount_usd: 12.5,
      currency: 'paypal',
      customer_email: 'Buyer@Example.com',
      account_id: 'user_42',
      property: 'https://bl0ggers.com/p/1',
      success_url: 'https://bl0ggers.com/thanks',
    }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data).toMatchObject({ success: true, payment_method: 'paypal', payment_id: 'tx-1', paypal_order_id: 'ORDER1' });
    const input = createPaypal.mock.calls[0][1];
    expect(input.businessId).toBe('biz-pp');
    expect(input.customerEmail).toBe('buyer@example.com');
    expect(input.metadata).toMatchObject({
      customer_email: 'buyer@example.com',
      account_id: 'user_42',
      property: 'bl0ggers.com',
      platform: 'bl0ggers',
    });
    expect(input.successUrl).toBe('https://bl0ggers.com/thanks');
  });

  it('says so when the seller has no PayPal', async () => {
    paypalConnected = false;
    const res = await POST(req({ merchant_id: MERCHANT, amount_usd: 5, currency: 'USD', payment_method: 'paypal' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PAYPAL_NOT_CONNECTED');
  });

  it('records customer fields on crypto payments and drops malformed ones', async () => {
    const res = await POST(req({
      merchant_id: MERCHANT,
      amount_usd: 5,
      currency: 'usdc_pol',
      customer_email: 'not-an-email',
      account_id: 'user_7',
    }));
    expect(res.status).toBe(201);
    const meta = createPaymentMock.mock.calls[0][1].metadata;
    expect(meta.account_id).toBe('user_7');
    expect(meta.customer_email).toBeUndefined();
  });
});
