import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn().mockReturnValue({ userId: 'merch-1' }),
}));

vi.mock('@/lib/secrets', () => ({
  getJwtSecret: vi.fn().mockReturnValue('test-secret'),
}));

const mockListWallets = vi.fn();
vi.mock('@/lib/wallets/service', () => ({
  listWallets: (...args: any[]) => mockListWallets(...args),
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

function setupStripe(account: any) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'stripe_accounts') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: account, error: account ? null : { code: 'PGRST116' } }),
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
  });

  it('returns active crypto wallets and card enabled when Stripe charges are on', async () => {
    mockListWallets.mockResolvedValue({
      success: true,
      wallets: [
        { cryptocurrency: 'BTC', wallet_address: 'bc1q', is_active: true },
        { cryptocurrency: 'SOL', wallet_address: 'sol1', is_active: true },
        { cryptocurrency: 'ETH', wallet_address: '0xeth', is_active: false },
      ],
    });
    setupStripe({ stripe_account_id: 'acct_1', charges_enabled: true });

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.crypto.map((c: any) => c.cryptocurrency)).toEqual(['BTC', 'SOL']); // inactive filtered
    expect(body.card).toEqual({ enabled: true, stripe_account_id: 'acct_1' });
  });

  it('reports card disabled when charges are not enabled', async () => {
    mockListWallets.mockResolvedValue({ success: true, wallets: [] });
    setupStripe({ stripe_account_id: 'acct_1', charges_enabled: false });

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    const body = await res.json();

    expect(body.card.enabled).toBe(false);
    expect(body.crypto).toEqual([]);
  });

  it('reports card disabled when there is no Stripe account', async () => {
    mockListWallets.mockResolvedValue({ success: true, wallets: [] });
    setupStripe(null);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    const body = await res.json();

    expect(body.card).toEqual({ enabled: false, stripe_account_id: null });
  });

  it('400s when the business is not accessible', async () => {
    mockListWallets.mockResolvedValue({ success: false, error: 'Business not found or access denied' });
    setupStripe(null);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'biz-1' }) });
    expect(res.status).toBe(400);
  });
});
