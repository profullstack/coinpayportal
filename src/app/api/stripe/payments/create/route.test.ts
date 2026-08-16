import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase, mockAuthorize } = vi.hoisted(() => {
  const mockAuthorize = vi.fn();
  const mockStripe = {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/pay/cs_test_123',
        }),
      },
    },
  };

  const mockSupabase = {
    from: vi.fn(),
  };

  return { mockStripe, mockSupabase, mockAuthorize };
});

// The gate itself is unit-tested in src/lib/auth/payment-auth.test.ts; here we
// only care that the route refuses to act when it says no.
vi.mock('@/lib/auth/payment-auth', () => ({
  authorizePaymentCreation: mockAuthorize,
}));

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mockStripe),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

// Tier resolution is unit-tested in src/lib/entitlements/service.test.ts.
// Here it is stubbed so both fee tiers can be exercised through the route.
const mockIsBusinessPaidTier = vi.hoisted(() => vi.fn());
vi.mock('@/lib/entitlements/service', () => ({
  isBusinessPaidTier: mockIsBusinessPaidTier,
}));

import { POST } from './route';

function mockFromChain(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    businesses: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { tier: 'free', merchant_id: 'merchant_123' },
          }),
        }),
      }),
    },
    stripe_accounts: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { stripe_account_id: 'acct_123', charges_enabled: true },
          }),
        }),
      }),
    },
    stripe_transactions: {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'txn_test_1' }, error: null }),
        }),
      }),
    },
  };

  const merged = { ...defaults, ...overrides };
  mockSupabase.from.mockImplementation((table: string) => merged[table] || {
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
  });
}

describe('POST /api/stripe/payments/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
    mockAuthorize.mockResolvedValue({ ok: true, via: 'api_key', merchantId: 'merchant_123' });
    mockIsBusinessPaidTier.mockResolvedValue(false);
    mockFromChain();
  });

  it('should create a card payment checkout session', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        amount: 10000,
        currency: 'usd',
        description: 'Test payment',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_123');
    expect(data.checkout_session_id).toBe('cs_test_123');
    // Free tier: 1% of 10000. This rail used to hardcode 0.5% for everyone,
    // billing free-tier merchants half the commission they owe.
    expect(data.platform_fee_amount).toBe(100);
  });

  it('should charge the professional rate for a paid-tier merchant', async () => {
    mockIsBusinessPaidTier.mockResolvedValue(true);

    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        amount: 10000,
        currency: 'usd',
        description: 'Test payment',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.platform_fee_amount).toBe(50); // 0.5% of 10000
  });

  it('should return 400 for missing required fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({ businessId: 'biz_123' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('should return 404 when business not found', async () => {
    mockFromChain({
      businesses: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_nonexistent',
        amount: 10000,
        currency: 'usd',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it('rejects an unauthenticated request before touching Stripe', async () => {
    mockAuthorize.mockResolvedValue({ ok: false, status: 401, error: 'Missing API key' });

    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({ businessId: 'biz_123', amount: 10000, currency: 'usd' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a key belonging to a different business', async () => {
    mockAuthorize.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'API key does not belong to this business',
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({ businessId: 'biz_someone_else', amount: 10000, currency: 'usd' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('checks authorization against the business being charged', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/payments/create', {
      method: 'POST',
      body: JSON.stringify({ businessId: 'biz_123', amount: 10000, currency: 'usd' }),
    });

    await POST(request);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'biz_123');
  });
});
