import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock Stripe
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

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mockStripe),
}));

// Mock Supabase
const mockSupabase = {
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null, // No existing account
        }),
      }),
    }),
    insert: vi.fn().mockResolvedValue({
      data: [{ id: 'stripe_account_123' }],
    }),
  }),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

describe('POST /api/stripe/connect/onboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
  });

  it('should create new Stripe account and onboarding link', async () => {
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
    expect(data.stripe_account_id).toBe('acct_test123');
    expect(data.onboarding_url).toBe('https://connect.stripe.com/setup/onboarding/acct_test123');

    expect(mockStripe.accounts.create).toHaveBeenCalledWith({
      type: 'express',
      country: 'US',
      email: 'merchant@example.com',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
    });

    expect(mockStripe.accountLinks.create).toHaveBeenCalledWith({
      account: 'acct_test123',
      refresh_url: 'https://coinpayportal.com/dashboard/settings',
      return_url: 'https://coinpayportal.com/dashboard/settings?stripe_onboarding=complete',
      type: 'account_onboarding',
    });
  });

  it('should use existing Stripe account if already created', async () => {
    // Mock existing account
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { stripe_account_id: 'acct_existing123' },
          }),
        }),
      }),
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        email: 'merchant@example.com',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stripe_account_id).toBe('acct_existing123');

    // Should not create new account
    expect(mockStripe.accounts.create).not.toHaveBeenCalled();

    // Should still create onboarding link
    expect(mockStripe.accountLinks.create).toHaveBeenCalledWith({
      account: 'acct_existing123',
      refresh_url: 'https://coinpayportal.com/dashboard/settings',
      return_url: 'https://coinpayportal.com/dashboard/settings?stripe_onboarding=complete',
      type: 'account_onboarding',
    });
  });

  it('should return 400 for missing businessId', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        email: 'merchant@example.com',
        // Missing businessId
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('businessId is required');
  });

  it('should default to US country if not specified', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        businessId: 'biz_123',
        email: 'merchant@example.com',
        // No country specified
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'US',
      })
    );
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