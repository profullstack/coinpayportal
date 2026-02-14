import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Use vi.hoisted so mocks are available in vi.mock factories
const { mockStripe, mockSupabase } = vi.hoisted(() => {
  const mockStripe = {
    accounts: {
      create: vi.fn().mockResolvedValue({
        id: 'acct_test123',
        type: 'express',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        country: 'US',
        email: 'test@example.com',
      }),
    },
    accountLinks: {
      create: vi.fn().mockResolvedValue({
        url: 'https://connect.stripe.com/setup/onboarding/acct_test123',
      }),
    },
  };

  const mockSupabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
          }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({
        data: [{ id: 'stripe_account_123' }],
      }),
    }),
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

describe('POST /api/stripe/connect/onboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';

    // Reset default mock behavior
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: [{ id: 'stripe_account_123' }] }),
    });
  });

  it('should create new Stripe account and onboarding link with camelCase businessId', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        email: 'merchant@example.com',
        country: 'US',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.stripe_account_id).toBe('acct_test123');
    expect(data.url).toBe('https://connect.stripe.com/setup/onboarding/acct_test123');
    expect(data.onboarding_url).toBe('https://connect.stripe.com/setup/onboarding/acct_test123');
  });

  it('should accept snake_case business_id', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'biz_456',
        email: 'merchant@example.com',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.url).toBeTruthy();
  });

  it('should return 400 for missing businessId', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        email: 'merchant@example.com',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('businessId is required');
  });

  it('should handle Stripe errors gracefully', async () => {
    mockStripe.accounts.create.mockRejectedValue(new Error('Stripe API error'));

    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        email: 'merchant@example.com',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Stripe API error');
  });
});
