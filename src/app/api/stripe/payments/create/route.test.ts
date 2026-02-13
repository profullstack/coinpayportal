import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase } = vi.hoisted(() => {
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
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
    },
    stripe_escrows: {
      insert: vi.fn().mockResolvedValue({ data: [{}] }),
    },
  };

  const merged = { ...defaults, ...overrides };
  mockSupabase.from.mockImplementation((table: string) => merged[table] || { insert: vi.fn() });
}

describe('POST /api/stripe/payments/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
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
    expect(data.platform_fee_amount).toBe(100); // 1% of 10000
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
});
