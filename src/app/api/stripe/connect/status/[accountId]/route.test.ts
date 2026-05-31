import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase, mockResolveMerchant, mockVerifyBusinessAccess } = vi.hoisted(() => {
  const mockStripe = {
    accounts: {
      retrieve: vi.fn().mockResolvedValue({
        id: 'acct_test123',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        country: 'US',
        email: 'merchant@example.com',
        requirements: {
          currently_due: [],
          disabled_reason: null,
        },
      }),
    },
  };

  const mockSupabase = {
    from: vi.fn(),
  };

  return {
    mockStripe,
    mockSupabase,
    mockResolveMerchant: vi.fn(),
    mockVerifyBusinessAccess: vi.fn(),
  };
});

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => mockStripe),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}));

vi.mock('@/lib/auth/merchant', () => ({
  resolveMerchant: (...args: unknown[]) => mockResolveMerchant(...args),
}));

vi.mock('@/lib/wallets/supported-coins', () => ({
  verifyBusinessAccess: (...args: unknown[]) => mockVerifyBusinessAccess(...args),
}));

import { GET } from './route';

function mockFromChain(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    stripe_accounts: {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { stripe_account_id: 'acct_test123' },
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{}] }),
      }),
    },
  };

  const merged = { ...defaults, ...overrides };
  mockSupabase.from.mockImplementation((table: string) => merged[table] || {});
}

describe('GET /api/stripe/connect/status/[accountId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockResolveMerchant.mockResolvedValue({ merchantId: 'merchant_uuid_123', apiKeyBusinessId: null });
    mockVerifyBusinessAccess.mockResolvedValue({ ok: true });
    mockFromChain();
  });

  it('should return account status for a valid merchant', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/status/merch_123');

    const response = await GET(request, { params: Promise.resolve({ accountId: 'merch_123' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stripe_account_id).toBe('acct_test123');
    expect(data.charges_enabled).toBe(true);
    expect(data.payouts_enabled).toBe(true);
    expect(data.details_submitted).toBe(true);
    expect(data.onboarding_complete).toBe(true);
    expect(data.country).toBe('US');
    expect(data.email).toBe('merchant@example.com');
  });

  it('should return 404 when stripe account not found', async () => {
    mockFromChain({
      stripe_accounts: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/connect/status/nonexistent');

    const response = await GET(request, { params: Promise.resolve({ accountId: 'nonexistent' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Stripe account not found');
  });

  it('should reject status lookups outside the authenticated merchant scope', async () => {
    mockVerifyBusinessAccess.mockResolvedValue({
      ok: false,
      error: 'Business not found or access denied',
      status: 404,
    });
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/status/other_business');

    const response = await GET(request, { params: Promise.resolve({ accountId: 'other_business' }) });

    expect(response.status).toBe(404);
    expect(mockStripe.accounts.retrieve).not.toHaveBeenCalled();
  });

  it('should report incomplete onboarding', async () => {
    mockStripe.accounts.retrieve.mockResolvedValue({
      id: 'acct_test123',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      country: 'US',
      email: 'merchant@example.com',
      requirements: {
        currently_due: ['individual.verification.document'],
        disabled_reason: 'requirements.past_due',
      },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/connect/status/merch_123');

    const response = await GET(request, { params: Promise.resolve({ accountId: 'merch_123' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.onboarding_complete).toBe(false);
    expect(data.charges_enabled).toBe(false);
    expect(data.requirements_due).toContain('individual.verification.document');
    expect(data.disabled_reason).toBe('requirements.past_due');
  });

  it('should handle Stripe API errors', async () => {
    mockStripe.accounts.retrieve.mockRejectedValue(new Error('Stripe API error'));

    const request = new NextRequest('http://localhost:3000/api/stripe/connect/status/merch_123');

    const response = await GET(request, { params: Promise.resolve({ accountId: 'merch_123' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Stripe API error');
  });
});
