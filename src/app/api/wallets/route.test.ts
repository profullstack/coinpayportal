import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/wallets/user-wallets', () => ({
  listUserWallets: vi.fn(),
}));

vi.mock('@/lib/wallets/merchant-service', () => ({
  createMerchantWallet: vi.fn(),
}));

import { GET, POST } from './route';
import { listUserWallets } from '@/lib/wallets/user-wallets';
import { createMerchantWallet } from '@/lib/wallets/merchant-service';

const JWT_SECRET = 'session-secret-for-tests';
const OIDC_SECRET = 'oidc-secret-for-tests';

const sessionToken = () =>
  jwt.sign({ userId: 'user-123' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

const oauthToken = (scope: string) =>
  jwt.sign(
    { sub: 'user-123', client_id: 'cp_02526f19', scope, token_type: 'access' },
    OIDC_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

function makeRequest(url: string, init: RequestInit = {}): any {
  return new Request(url, init);
}

const businessWallet = {
  id: 'bw-1',
  source: 'business',
  merchant_id: null,
  business_id: 'biz-abc',
  business_name: 'Acme Inc',
  cryptocurrency: 'ETH',
  wallet_address: '0xbusiness',
  label: null,
  is_active: true,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

describe('GET /api/wallets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    vi.stubEnv('OIDC_SIGNING_SECRET', OIDC_SECRET);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    (listUserWallets as any).mockResolvedValue({ success: true, wallets: [businessWallet] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('401s without an authorization header', async () => {
    const res = await GET(makeRequest('https://coinpay.dev/api/wallets'));
    expect(res.status).toBe(401);
  });

  it('returns business wallets for an OAuth token with wallet:read — issue #187', async () => {
    const res = await GET(
      makeRequest('https://coinpay.dev/api/wallets', {
        headers: { authorization: `Bearer ${oauthToken('openid profile email wallet:read')}` },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.wallets).toHaveLength(1);
    expect(body.wallets[0].wallet_address).toBe('0xbusiness');
    expect(body.wallets[0].business_id).toBe('biz-abc');

    // Subject came from the token's `sub`, not an absent `userId` claim.
    expect(listUserWallets).toHaveBeenCalledWith(expect.anything(), 'user-123', {
      source: 'all',
      businessId: undefined,
    });
  });

  it('403s an OAuth token that lacks wallet:read', async () => {
    const res = await GET(
      makeRequest('https://coinpay.dev/api/wallets', {
        headers: { authorization: `Bearer ${oauthToken('openid profile')}` },
      })
    );

    expect(res.status).toBe(403);
    expect(res.headers.get('WWW-Authenticate')).toContain('insufficient_scope');
    expect(listUserWallets).not.toHaveBeenCalled();
  });

  it('serves dashboard session tokens without any scope', async () => {
    const res = await GET(
      makeRequest('https://coinpay.dev/api/wallets', {
        headers: { authorization: `Bearer ${sessionToken()}` },
      })
    );

    expect(res.status).toBe(200);
  });

  it('passes source and business_id through', async () => {
    await GET(
      makeRequest('https://coinpay.dev/api/wallets?source=business&business_id=biz-abc', {
        headers: { authorization: `Bearer ${sessionToken()}` },
      })
    );

    expect(listUserWallets).toHaveBeenCalledWith(expect.anything(), 'user-123', {
      source: 'business',
      businessId: 'biz-abc',
    });
  });

  it('rejects an unknown source', async () => {
    const res = await GET(
      makeRequest('https://coinpay.dev/api/wallets?source=nonsense', {
        headers: { authorization: `Bearer ${sessionToken()}` },
      })
    );

    expect(res.status).toBe(400);
    expect(listUserWallets).not.toHaveBeenCalled();
  });

  it('propagates the status of a failed lookup', async () => {
    (listUserWallets as any).mockResolvedValue({
      success: false,
      error: 'Business not found',
      status: 404,
    });

    const res = await GET(
      makeRequest('https://coinpay.dev/api/wallets?business_id=someone-elses', {
        headers: { authorization: `Bearer ${sessionToken()}` },
      })
    );

    expect(res.status).toBe(404);
  });
});

describe('POST /api/wallets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    vi.stubEnv('OIDC_SIGNING_SECRET', OIDC_SECRET);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    (createMerchantWallet as any).mockResolvedValue({
      success: true,
      wallet: { id: 'mw-1' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const body = JSON.stringify({ cryptocurrency: 'BTC', wallet_address: 'bc1qtest' });

  it('creates an account-level wallet for a dashboard session', async () => {
    const res = await POST(
      makeRequest('https://coinpay.dev/api/wallets', {
        method: 'POST',
        headers: { authorization: `Bearer ${sessionToken()}`, 'content-type': 'application/json' },
        body,
      })
    );

    expect(res.status).toBe(201);
    expect(createMerchantWallet).toHaveBeenCalledWith(
      expect.anything(),
      'user-123',
      expect.objectContaining({ cryptocurrency: 'BTC' })
    );
  });

  it('refuses OAuth tokens — no scope grants wallet writes', async () => {
    const res = await POST(
      makeRequest('https://coinpay.dev/api/wallets', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oauthToken('openid wallet:read')}`,
          'content-type': 'application/json',
        },
        body,
      })
    );

    expect(res.status).toBe(403);
    expect(createMerchantWallet).not.toHaveBeenCalled();
  });
});
