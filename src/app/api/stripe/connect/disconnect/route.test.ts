import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockStripe, mockSupabase, mockResolveMerchant, mockVerifyBusinessAccess } = vi.hoisted(() => {
  const mockStripe = {
    accounts: {
      del: vi.fn().mockResolvedValue({ id: 'acct_test123', deleted: true }),
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

import { DELETE } from './route';

function makeStripeAccountsMock(existingAccount: { stripe_account_id: string } | null = { stripe_account_id: 'acct_test123' }) {
  const eqDelete = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: existingAccount }),
      }),
    }),
    delete: vi.fn().mockReturnValue({ eq: eqDelete }),
    _eqDelete: eqDelete,
  };
}

function setupSupabase(accountMock = makeStripeAccountsMock()) {
  mockSupabase.from.mockReturnValue(accountMock);
  return accountMock;
}

describe('DELETE /api/stripe/connect/disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockResolveMerchant.mockResolvedValue({ merchantId: 'merchant_uuid_123', apiKeyBusinessId: null });
    mockVerifyBusinessAccess.mockResolvedValue({ ok: true });
    setupSupabase();
  });

  it('should delete Stripe account and remove local record', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ business_id: 'biz_123' }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockStripe.accounts.del).toHaveBeenCalledWith('acct_test123');
  });

  it('should accept camelCase businessId', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ businessId: 'biz_123' }),
    });

    const response = await DELETE(request);
    expect(response.status).toBe(200);
  });

  it('should return 400 when businessId is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('businessId is required');
  });

  it('should return 404 when no Stripe account exists', async () => {
    setupSupabase(makeStripeAccountsMock(null));
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ business_id: 'biz_123' }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toMatch(/No Stripe Connect account/);
  });

  it('should return 401 for unauthenticated request', async () => {
    mockResolveMerchant.mockResolvedValue({ error: 'Missing authorization header', status: 401 });
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ business_id: 'biz_123' }),
    });

    const response = await DELETE(request);

    expect(response.status).toBe(401);
    expect(mockStripe.accounts.del).not.toHaveBeenCalled();
  });

  it('should proceed with local cleanup if Stripe says account does not exist', async () => {
    mockStripe.accounts.del.mockRejectedValueOnce(new Error('No such account: acct_test123'));
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ business_id: 'biz_123' }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should propagate unexpected Stripe errors', async () => {
    mockStripe.accounts.del.mockRejectedValueOnce(new Error('Stripe API unavailable'));
    const request = new NextRequest('http://localhost:3000/api/stripe/connect/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ business_id: 'biz_123' }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Stripe API unavailable');
  });
});
