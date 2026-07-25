import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSingle = vi.fn();
// merchant_dids lookup uses .maybeSingle(); share the mock fn so existing
// tests that drive call ordering via mockSingle keep working.
const mockEq = vi.fn(() => ({ single: mockSingle, maybeSingle: mockSingle, eq: mockEq }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      return { select: mockSelect };
    }),
  })),
}));

vi.mock('@/lib/oauth/tokens', () => ({
  verifyAccessToken: vi.fn(),
}));

import { GET } from './route';
import { verifyAccessToken } from '@/lib/oauth/tokens';

function makeRequest(headers: Record<string, string> = {}): any {
  return new Request('https://coinpay.dev/api/oauth/userinfo', {
    headers,
  });
}

describe('GET /api/oauth/userinfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  });

  it('should return 401 without auth header', async () => {
    const req = makeRequest();
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('should return 401 for invalid token', async () => {
    (verifyAccessToken as any).mockImplementation(() => {
      throw new Error('Invalid token');
    });

    const req = makeRequest({ authorization: 'Bearer invalid-token' });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_token');
  });

  it('should return 401 for expired token', async () => {
    (verifyAccessToken as any).mockImplementation(() => {
      throw new Error('Token has expired');
    });

    const req = makeRequest({ authorization: 'Bearer expired-token' });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('should return user info with valid token and profile scope', async () => {
    (verifyAccessToken as any).mockReturnValue({
      sub: 'user-123',
      scope: 'openid profile email',
    });

    mockSingle.mockResolvedValue({
      data: {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        
        updated_at: '2024-01-01T00:00:00Z',
        email_verified: true,
      },
      error: null,
    });

    const req = makeRequest({ authorization: 'Bearer valid-token' });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sub).toBe('user-123');
    expect(body.name).toBe('Test User');
    
    expect(body.email).toBe('test@example.com');
    expect(body.email_verified).toBe(true);
  });

  it('should return email_verified as false when not verified', async () => {
    (verifyAccessToken as any).mockReturnValue({
      sub: 'user-123',
      scope: 'openid email',
    });

    mockSingle.mockResolvedValue({
      data: {
        id: 'user-123',
        email: 'test@example.com',
        
      },
      error: null,
    });

    const req = makeRequest({ authorization: 'Bearer valid-token' });
    const res = await GET(req);
    const body = await res.json();
    expect(body.email_verified).toBe(true);
  });

  it('should default email_verified to false when missing', async () => {
    (verifyAccessToken as any).mockReturnValue({
      sub: 'user-123',
      scope: 'openid email',
    });

    mockSingle.mockResolvedValue({
      data: {
        id: 'user-123',
        email: 'test@example.com',
        // no email_verified field
      },
      error: null,
    });

    const req = makeRequest({ authorization: 'Bearer valid-token' });
    const res = await GET(req);
    const body = await res.json();
    expect(body.email_verified).toBe(true);
  });

  it('should respect scopes — only openid returns sub', async () => {
    (verifyAccessToken as any).mockReturnValue({
      sub: 'user-123',
      scope: 'openid',
    });

    mockSingle.mockResolvedValue({
      data: {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      },
      error: null,
    });

    const req = makeRequest({ authorization: 'Bearer valid-token' });
    const res = await GET(req);
    const body = await res.json();

    expect(body.sub).toBe('user-123');
    expect(body.email).toBeUndefined();
    expect(body.name).toBeUndefined();
  });

  it('should include did when did scope is present', async () => {
    (verifyAccessToken as any).mockReturnValue({
      sub: 'user-123',
      scope: 'openid did',
    });

    let callNum = 0;
    mockSingle.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return Promise.resolve({
          data: { id: 'user-123' },
          error: null,
        });
      }
      return Promise.resolve({
        data: { did: 'did:example:123' },
        error: null,
      });
    });

    const req = makeRequest({ authorization: 'Bearer valid-token' });
    const res = await GET(req);
    const body = await res.json();

    expect(body.sub).toBe('user-123');
    expect(body.did).toBe('did:example:123');
  });

  it('should include wallets when wallet:read scope is present', async () => {
    (verifyAccessToken as any).mockReturnValue({
      sub: 'user-123',
      scope: 'openid wallet:read',
    });

    let callNum = 0;
    mockSingle.mockImplementation(() => {
      callNum++;
      // merchant lookup
      return Promise.resolve({
        data: { id: 'user-123' },
        error: null,
      });
    });

    // Override from to handle the merchant_wallets table (.eq().eq() chain
    // because we filter by both merchant_id and is_active).
    const { createClient } = await import('@supabase/supabase-js');
    const mockWalletRows = [
      { wallet_address: '0xabc123', cryptocurrency: 'ETH', label: 'Main wallet' },
      { wallet_address: 'bc1q...', cryptocurrency: 'BTC', label: null },
    ];
    const mockWalletInnerEq = vi.fn(() =>
      Promise.resolve({ data: mockWalletRows, error: null }),
    );
    const mockWalletOuterEq = vi.fn(() => ({ eq: mockWalletInnerEq }));
    const mockWalletSelect = vi.fn(() => ({ eq: mockWalletOuterEq }));

    (createClient as any).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'merchant_wallets') {
          return { select: mockWalletSelect };
        }
        if (table === 'merchant_dids') {
          return { select: mockSelect };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }),
            })),
          })),
        };
      }),
    });

    const req = makeRequest({ authorization: 'Bearer valid-token' });
    const res = await GET(req);
    const body = await res.json();

    expect(body.sub).toBe('user-123');
    expect(body.wallets).toBeDefined();
    expect(body.wallets).toHaveLength(2);
    // Wallets come back sorted by cryptocurrency, so BTC precedes ETH.
    expect(body.wallets[0].address).toBe('bc1q...');
    expect(body.wallets[0].chain).toBe('BTC');
    expect(body.wallets[1].address).toBe('0xabc123');
    expect(body.wallets[1].chain).toBe('ETH');
  });

  it('should include wallets that belong to the user’s businesses (issue #187)', async () => {
    (verifyAccessToken as any).mockReturnValue({
      sub: 'user-123',
      scope: 'openid wallet:read',
    });

    mockSingle.mockResolvedValue({ data: { id: 'user-123' }, error: null });

    const { createClient } = await import('@supabase/supabase-js');

    // Thenable query stub: `.eq()`/`.in()` chain and resolve to `result`.
    const query = (result: any) => {
      const q: any = {
        eq: vi.fn(() => q),
        in: vi.fn(() => q),
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
      };
      return q;
    };

    (createClient as any).mockReturnValue({
      from: vi.fn((table: string) => {
        // The account has no global wallets at all — every address lives on a
        // business, which is the standard setup that used to return nothing.
        if (table === 'merchant_wallets') {
          return { select: vi.fn(() => query({ data: [], error: null })) };
        }
        if (table === 'businesses') {
          // Serves both the ownership lookup (.eq) and the name lookup (.in).
          return {
            select: vi.fn(() =>
              query({ data: [{ id: 'biz-abc', name: 'Acme Inc' }], error: null }),
            ),
          };
        }
        if (table === 'business_wallets') {
          return {
            select: vi.fn(() =>
              query({
                data: [
                  {
                    id: 'bw-1',
                    business_id: 'biz-abc',
                    cryptocurrency: 'ETH',
                    wallet_address: '0xbusiness',
                    is_active: true,
                    created_at: '2026-02-01T00:00:00Z',
                    updated_at: '2026-02-01T00:00:00Z',
                  },
                ],
                error: null,
              }),
            ),
          };
        }
        if (table === 'merchant_dids') {
          return { select: mockSelect };
        }
        // business_members / organization_members / merchants
        return {
          select: vi.fn(() => ({
            ...query({ data: [], error: null }),
            eq: vi.fn(() => ({
              ...query({ data: [], error: null }),
              single: () => Promise.resolve({ data: { id: 'user-123' }, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            })),
          })),
        };
      }),
    });

    const req = makeRequest({ authorization: 'Bearer valid-token' });
    const res = await GET(req);
    const body = await res.json();

    expect(body.wallets).toHaveLength(1);
    expect(body.wallets[0].address).toBe('0xbusiness');
    expect(body.wallets[0].chain).toBe('ETH');
    expect(body.wallets[0].business_id).toBe('biz-abc');
    // business_wallets has no label column; fall back to the business name.
    expect(body.wallets[0].label).toBe('Acme Inc');
  });
});
