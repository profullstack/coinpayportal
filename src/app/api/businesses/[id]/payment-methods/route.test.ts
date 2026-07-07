import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockResolveMerchant = vi.fn();
vi.mock('@/lib/auth/merchant', () => ({
  resolveMerchant: (...args: any[]) => mockResolveMerchant(...args),
}));

const mockAuthorizeBusiness = vi.fn();
vi.mock('@/lib/auth/authz', () => ({
  authorizeBusiness: (...args: any[]) => mockAuthorizeBusiness(...args),
}));

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

import { GET } from './route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/businesses/biz-1/payment-methods', {
    headers: { Authorization: 'Bearer test-token' },
  });
}

// Wire up the two tables the route reads: business_wallets (crypto) + stripe_accounts (card).
function setupTables(wallets: any[], stripeAccount: any) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'business_wallets') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: wallets, error: null }),
          }),
        }),
      };
    }
    if (table === 'stripe_accounts') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: stripeAccount, error: stripeAccount ? null : { code: 'PGRST116' } }),
          }),
        }),
      };
    }
    return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null }) }) }) };
  });
}

describe('GET /api/businesses/[id]/payment-methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    // Default: a team member with read access to the business.
    mockResolveMerchant.mockResolvedValue({ merchantId: 'merch-1', apiKeyBusinessId: null });
    mockAuthorizeBusiness.mockResolvedValue({ ok: true, role: 'owner' });
  });

  it('returns active crypto wallets and card enabled when Stripe charges are on', async () => {
    setupTables(
      [
        { cryptocurrency: 'BTC', wallet_address: 'bc1q', is_active: true },
        { cryptocurrency: 'SOL', wallet_address: 'sol1', is_active: true },
        { cryptocurrency: 'ETH', wallet_address: '0xeth', is_active: false },
      ],
      { stripe_account_id: 'acct_1', charges_enabled: true },
    );

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.crypto.map((c: any) => c.cryptocurrency)).toEqual(['BTC', 'SOL']); // inactive filtered
    expect(body.card).toEqual({ enabled: true, stripe_account_id: 'acct_1' });
  });

  it('reports card disabled when charges are not enabled', async () => {
    setupTables([], { stripe_account_id: 'acct_1', charges_enabled: false });

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    const body = await res.json();

    expect(body.card.enabled).toBe(false);
    expect(body.crypto).toEqual([]);
  });

  it('reports card disabled when there is no Stripe account', async () => {
    setupTables([], null);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    const body = await res.json();

    expect(body.card).toEqual({ enabled: false, stripe_account_id: null });
  });

  it('works for a team member (authorized by business role, not ownership)', async () => {
    // The whole point of the fix: a non-owner with a role still sees the methods.
    mockAuthorizeBusiness.mockResolvedValue({ ok: true, role: 'writer' });
    setupTables([{ cryptocurrency: 'BTC', wallet_address: 'bc1q', is_active: true }], {
      stripe_account_id: 'acct_1',
      charges_enabled: true,
    });

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.card.enabled).toBe(true);
    expect(body.crypto).toHaveLength(1);
  });

  it('404s when the business is not accessible', async () => {
    mockAuthorizeBusiness.mockResolvedValue({ ok: false, status: 404, error: 'Business not found' });
    setupTables([], null);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(404);
  });
});
