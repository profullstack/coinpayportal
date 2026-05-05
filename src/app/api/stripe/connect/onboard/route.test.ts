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

interface SupabaseMockOpts {
  business?: { merchant_id: string; country: string | null } | null;
  existingAccount?: { stripe_account_id: string } | null;
}

function makeBusinessMock(business: SupabaseMockOpts['business'] = { merchant_id: 'merchant_uuid_123', country: null }) {
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    update: vi.fn().mockReturnValue({ eq: updateEq }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: business }),
      }),
    }),
    _updateEq: updateEq,
  };
}

function makeStripeAccountsMock(existingAccount: SupabaseMockOpts['existingAccount'] = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: existingAccount }),
      }),
    }),
    insert: vi.fn().mockResolvedValue({ data: [{ id: 'stripe_account_123' }], error: null }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  };
}

function setupSupabase(opts: SupabaseMockOpts = {}) {
  const businessMock = makeBusinessMock(opts.business);
  const stripeAccountsMock = makeStripeAccountsMock(opts.existingAccount);
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'businesses') return businessMock;
    return stripeAccountsMock;
  });
  return { businessMock, stripeAccountsMock };
}

describe('POST /api/stripe/connect/onboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://coinpayportal.com';
    mockStripe.accounts.create.mockResolvedValue({
      id: 'acct_test123',
      type: 'express',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      country: 'US',
      email: 'test@example.com',
    });
    setupSupabase();
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
    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'US' })
    );
  });

  it('should accept snake_case business_id with explicit country', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'biz_456',
        email: 'merchant@example.com',
        country: 'GB',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'GB' })
    );
  });

  it('should support non-US Stripe Connect countries', async () => {
    mockStripe.accounts.create.mockResolvedValueOnce({
      id: 'acct_de_test',
      country: 'DE',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      email: 'merchant@example.de',
    });
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz_de', country: 'DE' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stripe_account_id).toBe('acct_de_test');
    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'DE' })
    );
  });

  it('should normalize lowercase country codes', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz_123', country: 'fr' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'FR' })
    );
  });

  it('should reject when country is missing and business has none stored', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz_456' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/country/i);
    expect(mockStripe.accounts.create).not.toHaveBeenCalled();
  });

  it('should reject country codes not on the Stripe Connect allowlist', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz_123', country: 'XX' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/country/i);
    expect(mockStripe.accounts.create).not.toHaveBeenCalled();
  });

  it('should fall back to country stored on the business when request omits it', async () => {
    setupSupabase({ business: { merchant_id: 'merchant_uuid_123', country: 'CA' } });
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz_ca' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'CA' })
    );
  });

  it('should persist the chosen country onto the business row', async () => {
    const { businessMock } = setupSupabase();
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({ business_id: 'biz_123', country: 'AU' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(businessMock.update).toHaveBeenCalledWith({ country: 'AU' });
  });

  it('should return 400 for missing businessId', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({
        email: 'merchant@example.com',
        country: 'US',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('businessId is required');
  });

  it('should handle Stripe errors gracefully', async () => {
    mockStripe.accounts.create.mockRejectedValueOnce(new Error('Stripe API error'));

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

    expect(response.status).toBe(500);
    expect(data.error).toBe('Stripe API error');
  });
});
