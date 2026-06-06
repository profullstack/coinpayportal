import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/middleware';
import { createSubscriptionPayment } from '@/lib/subscriptions/service';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn(),
  isMerchantAuth: vi.fn((context) => context.type === 'merchant'),
  isBusinessAuth: vi.fn((context) => context.type === 'business'),
}));

vi.mock('@/lib/subscriptions/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/subscriptions/service')>('@/lib/subscriptions/service');
  return {
    ...actual,
    createSubscriptionPayment: vi.fn(),
  };
});

describe('POST /api/subscriptions/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';

    vi.mocked(authenticateRequest).mockResolvedValue({
      success: true,
      context: {
        type: 'merchant',
        merchantId: 'merchant-1',
        userId: 'merchant-1',
      } as any,
    });

    vi.mocked(createSubscriptionPayment).mockResolvedValue({
      success: true,
      payment: {
        id: 'pay_sub_123',
        paymentAddress: '0x123',
        amount: 49,
        currency: 'USD',
        blockchain: 'ETH',
        expiresAt: '2026-06-06T12:15:00.000Z',
      },
    });
  });

  it('returns a hosted CoinPay checkout URL for subscription payments', async () => {
    const request = new NextRequest('http://localhost/api/subscriptions/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: 'professional',
        billing_period: 'monthly',
        blockchain: 'ETH',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.payment.id).toBe('pay_sub_123');
    expect(data.payment.checkout_path).toBe('/pay/pay_sub_123');
    expect(data.payment.checkout_url).toBe('https://coinpayportal.com/pay/pay_sub_123');
  });
});
