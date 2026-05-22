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
    expect(body.wallets[0].address).toBe('0xabc123');
    expect(body.wallets[0].chain).toBe('ETH');
    expect(body.wallets[1].address).toBe('bc1q...');
  });
});
