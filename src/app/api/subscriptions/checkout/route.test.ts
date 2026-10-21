import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/middleware';
import { createSubscriptionCheckout, countOpenSubscriptionCheckouts } from '@/lib/subscriptions/checkout';

vi.mock('@supabase/supabase-js', () => ({
  // SUB-02: the route now counts a merchant's unpaid checkouts before creating
  // another, so `from()` has to answer a head-count query.
  createClient: vi.fn(() => ({
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        then: (resolve: any) => resolve({ count: 0, error: null }),
      };
      return chain;
    }),
  })),
}));

// The per-merchant budget on subscription checkouts (SUB-02). Allowed here so
// these tests keep exercising the checkout path rather than the limiter.
vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true, resetAt: 0, limit: 10 }),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: vi.fn(),
  isMerchantAuth: vi.fn((context) => context.type === 'merchant'),
  isBusinessAuth: vi.fn((context) => context.type === 'business'),
}));

vi.mock('@/lib/subscriptions/checkout', () => ({
  createSubscriptionCheckout: vi.fn(),
  countOpenSubscriptionCheckouts: vi.fn(),
}));

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

    vi.mocked(countOpenSubscriptionCheckouts).mockResolvedValue(0);
    vi.mocked(createSubscriptionCheckout).mockResolvedValue({
      success: true,
      session: {
        id: 'cs_abcdefghijklmnopqrstuvwx',
        path: '/checkout/cs_abcdefghijklmnopqrstuvwx',
        url: 'https://coinpayportal.com/checkout/cs_abcdefghijklmnopqrstuvwx',
        amount: 49,
        expires_at: '2026-06-06T12:15:00.000Z',
        methods: ['USDC_POL', 'BTC', 'PAYPAL'],
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
    expect(data.session.id).toBe('cs_abcdefghijklmnopqrstuvwx');
    expect(data.session.methods).toContain('PAYPAL');
    expect(data.payment.checkout_path).toBe('/checkout/cs_abcdefghijklmnopqrstuvwx');
    expect(data.payment.checkout_url).toBe('https://coinpayportal.com/checkout/cs_abcdefghijklmnopqrstuvwx');
    // blockchain from older clients is accepted and ignored.
    expect(createSubscriptionCheckout).toHaveBeenCalledWith(expect.anything(), {
      merchantId: 'merchant-1',
      planId: 'professional',
      billingPeriod: 'monthly',
    });
  });
});

describe('POST /api/subscriptions/checkout limits', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    vi.mocked(authenticateRequest).mockResolvedValue({
      success: true,
      context: { type: 'merchant', merchantId: 'merchant-1', userId: 'merchant-1' } as any,
    });
  });

  it('refuses an 11th open plan checkout', async () => {
    vi.mocked(countOpenSubscriptionCheckouts).mockResolvedValue(10);
    vi.mocked(createSubscriptionCheckout).mockClear();
    const request = new NextRequest('http://localhost/api/subscriptions/checkout', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ plan_id: 'professional', billing_period: 'yearly' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
  });
});
