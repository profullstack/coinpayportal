import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreatePayLink = vi.fn();
const mockCreateUserWallet = vi.fn();
const mockGetPayLink = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/lightning/lnbits', () => ({
  createPayLink: (...args: unknown[]) => mockCreatePayLink(...args),
  createUserWallet: (...args: unknown[]) => mockCreateUserWallet(...args),
  getPayLink: (...args: unknown[]) => mockGetPayLink(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

describe('/api/lightning/address', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');

    mockFrom.mockImplementation((table: string) => {
      const state: {
        selectCols?: string;
        eqMap: Record<string, unknown>;
        neqMap: Record<string, unknown>;
        updateValues?: Record<string, unknown>;
      } = {
        eqMap: {},
        neqMap: {},
      };

      const query = {
        select: vi.fn((cols: string) => {
          state.selectCols = cols;
          return query;
        }),
        eq: vi.fn((key: string, value: unknown) => {
          state.eqMap[key] = value;
          return query;
        }),
        neq: vi.fn((key: string, value: unknown) => {
          state.neqMap[key] = value;
          return query;
        }),
        update: vi.fn((values: Record<string, unknown>) => {
          state.updateValues = values;
          return query;
        }),
        maybeSingle: vi.fn(async () => {
          if (table !== 'wallets') return { data: null, error: null };

          if (state.selectCols === 'id' && state.eqMap.ln_username) {
            return { data: null, error: null };
          }

          return { data: null, error: null };
        }),
        single: vi.fn(async () => {
          if (table !== 'wallets') return { data: null, error: null };

          // Username availability check
          if (state.selectCols === 'id' && state.eqMap.ln_username) {
            return { data: null, error: null };
          }

          // Wallet lookup
          if (typeof state.selectCols === 'string' && state.selectCols.includes('ln_wallet_adminkey')) {
            return {
              data: {
                id: 'w1',
                user_id: 'u1',
                ln_username: null,
                ln_wallet_adminkey: 'stale-admin-key',
                ln_paylink_id: null,
              },
              error: null,
            };
          }

          return { data: null, error: null };
        }),
      };

      return query;
    });
  });

  it('auto-recovers when LNbits wallet is missing and retries claim', async () => {
    mockCreatePayLink
      .mockRejectedValueOnce(new Error('LNbits API error 404: No wallet found'))
      .mockResolvedValueOnce({ id: 123 });

    mockCreateUserWallet.mockResolvedValue({
      id: 'ln-wallet-1',
      adminkey: 'fresh-admin-key',
      inkey: 'fresh-invoice-key',
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/lightning/address', {
      method: 'POST',
      body: JSON.stringify({ wallet_id: 'w1', username: 'chovy' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.lightning_address).toBe('chovy@coinpayportal.com');

    expect(mockCreatePayLink).toHaveBeenCalledTimes(2);
    expect(mockCreateUserWallet).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when wallet does not exist', async () => {
    mockFrom.mockImplementation(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        neq: vi.fn(() => query),
        update: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        single: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
      };
      return query;
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/lightning/address', {
      method: 'POST',
      body: JSON.stringify({ wallet_id: 'missing', username: 'chovy' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Wallet not found');
  });

  it('self-heals LNbits wallet linkage on GET when username exists', async () => {
    mockFrom.mockImplementation((table: string) => {
      const state: { selectCols?: string; eqMap: Record<string, unknown> } = { eqMap: {} };
      const query = {
        select: vi.fn((cols: string) => {
          state.selectCols = cols;
          return query;
        }),
        eq: vi.fn((key: string, value: unknown) => {
          state.eqMap[key] = value;
          return query;
        }),
        update: vi.fn(() => query),
        single: vi.fn(async () => {
          if (table !== 'wallets') return { data: null, error: null };
          return {
            data: {
              ln_username: 'chovy',
              ln_wallet_adminkey: 'stale-admin-key',
              ln_paylink_id: 99,
            },
            error: null,
          };
        }),
      };
      return query;
    });

    mockGetPayLink.mockRejectedValueOnce(new Error('LNbits API error 404: No wallet found'));
    mockCreateUserWallet.mockResolvedValue({
      id: 'ln-wallet-2',
      adminkey: 'fresh-admin-key',
      inkey: 'fresh-invoice-key',
    });
    mockCreatePayLink.mockResolvedValue({ id: 321 });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/lightning/address?wallet_id=w1');

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lightning_address).toBe('chovy@coinpayportal.com');
    expect(mockGetPayLink).toHaveBeenCalledTimes(1);
    expect(mockCreateUserWallet).toHaveBeenCalledTimes(1);
    expect(mockCreatePayLink).toHaveBeenCalledTimes(1);
  });
});
