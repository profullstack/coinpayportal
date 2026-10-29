import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle, eq: mockEq }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'oauth_consents') {
        return { select: mockSelect, upsert: mockUpsert };
      }
      if (table === 'oauth_authorization_codes') {
        return { insert: mockInsert };
      }
      return { select: mockSelect };
    }),
  })),
}));

vi.mock('@/lib/oauth/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/oauth/client')>()),
  validateClient: vi.fn(),
}));

vi.mock('@/lib/oauth/tokens', () => ({
  generateAuthorizationCode: vi.fn(() => 'mock-auth-code-64-hex-string-aaaa'),
}));

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(),
}));

import { GET, POST } from './route';
import { validateClient } from '@/lib/oauth/client';
import { verifyToken } from '@/lib/auth/jwt';

function makeRequest(url: string, options: RequestInit = {}): any {
  const request = new Request(url, options);
  // Add cookies getter
  Object.defineProperty(request, 'cookies', {
    get: () => ({
      get: (name: string) => {
        const cookieHeader = request.headers.get('cookie') || '';
        const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
        return match ? { value: match[1] } : undefined;
      },
    }),
  });
  return request;
}

describe('GET /api/oauth/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  });

  it('should reject non-code response_type', async () => {
    const req = makeRequest('https://coinpay.dev/api/oauth/authorize?response_type=token&client_id=test&redirect_uri=https://example.com/cb');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_response_type');
  });

  it('should reject missing client_id', async () => {
    const req = makeRequest('https://coinpay.dev/api/oauth/authorize?response_type=code&redirect_uri=https://example.com/cb');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('should reject invalid client_id', async () => {
    (validateClient as any).mockResolvedValue({ valid: false, error: 'Invalid client_id' });

    const req = makeRequest('https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=bad&redirect_uri=https://example.com/cb');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  it('should reject invalid redirect_uri', async () => {
    (validateClient as any).mockResolvedValue({ valid: false, error: 'Invalid redirect_uri' });

    const req = makeRequest('https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=cp_test&redirect_uri=https://evil.com/cb');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('should redirect to login if not authenticated', async () => {
    (validateClient as any).mockResolvedValue({
      valid: true,
      client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test', name: 'Test', redirect_uris: ['https://example.com/cb'] },
    });
    (verifyToken as any).mockImplementation(() => { throw new Error('invalid'); });

    // R4-ID-OAUTH: an authorization request must now carry `state` or PKCE.
    const req = makeRequest('https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=cp_test&redirect_uri=https://example.com/cb&scope=openid&state=xyz');
    const res = await GET(req);
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('/login');
  });

  it('refuses an authorization request bound by neither state nor PKCE', async () => {
    // R4-ID-OAUTH: the session cookie is sameSite=lax, so it rides along on a
    // top-level GET navigation. With nothing binding the request to the browser
    // that started it, a crafted link turns a victim's single click into a
    // completed authorization they never began — login-CSRF.
    (validateClient as any).mockResolvedValue({
      valid: true,
      client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test', name: 'Test', redirect_uris: ['https://example.com/cb'] },
    });

    const req = makeRequest('https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=cp_test&redirect_uri=https://example.com/cb&scope=openid');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('accepts a request bound by PKCE alone', async () => {
    // Most live clients send PKCE and no state; they must keep working.
    (validateClient as any).mockResolvedValue({
      valid: true,
      client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test', name: 'Test', redirect_uris: ['https://example.com/cb'] },
    });
    (verifyToken as any).mockImplementation(() => { throw new Error('invalid'); });

    const req = makeRequest('https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=cp_test&redirect_uri=https://example.com/cb&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const res = await GET(req);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('should redirect to consent for new client', async () => {
    (validateClient as any).mockResolvedValue({
      valid: true,
      client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test', name: 'Test' },
    });
    (verifyToken as any).mockReturnValue({ userId: 'user-123', email: 'test@example.com' });
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const req = makeRequest(
      'https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=cp_test&redirect_uri=https://example.com/cb&scope=openid+profile&state=abc123',
      { headers: { authorization: 'Bearer valid-token' } }
    );
    const res = await GET(req);
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('/oauth/consent');
    expect(location).toContain('state=abc123');
  });

  it('should return code directly for pre-consented client', async () => {
    (validateClient as any).mockResolvedValue({
      valid: true,
      client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test', name: 'Test' },
    });
    (verifyToken as any).mockReturnValue({ userId: 'user-123', email: 'test@example.com' });
    mockSingle.mockResolvedValue({
      data: { scopes: ['openid', 'profile'] },
      error: null,
    });

    const req = makeRequest(
      'https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=cp_test&redirect_uri=https://example.com/cb&scope=openid+profile&state=xyz',
      { headers: { authorization: 'Bearer valid-token' } }
    );
    const res = await GET(req);
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('https://example.com/cb');
    expect(location).toContain('code=');
    expect(location).toContain('state=xyz');
  });

  describe('prompt', () => {
    const base = 'https://coinpay.dev/api/oauth/authorize?response_type=code&client_id=cp_test&redirect_uri=https://example.com/cb&scope=openid+profile&state=xyz';
    const signedIn = { headers: { authorization: 'Bearer valid-token' } };

    beforeEach(() => {
      (validateClient as any).mockResolvedValue({ valid: true, client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test', name: 'Test' } });
      (verifyToken as any).mockReturnValue({ userId: 'user-123', email: 'test@example.com' });
      mockSingle.mockResolvedValue({ data: { scopes: ['openid', 'profile'] }, error: null });
    });

    it('select_account shows the consent screen even when already approved', async () => {
      const res = await GET(makeRequest(`${base}&prompt=select_account`, signedIn));
      expect(res.headers.get('location')).toContain('/oauth/consent');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('consent shows the consent screen even when already approved', async () => {
      const res = await GET(makeRequest(`${base}&prompt=consent`, signedIn));
      expect(res.headers.get('location')).toContain('/oauth/consent');
    });

    it('login sends a signed-in user to /login, returning without prompt=login', async () => {
      const res = await GET(makeRequest(`${base}&prompt=login`, signedIn));
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/login');
      const back = location.searchParams.get('redirect')!;
      expect(back.startsWith('/api/oauth/authorize?')).toBe(true);
      expect(back).not.toContain('prompt');
      expect(back).toContain('state=xyz');
    });

    it('a signed-out select_account does not ask again after login', async () => {
      (verifyToken as any).mockImplementation(() => { throw new Error('invalid'); });
      const res = await GET(makeRequest(`${base}&prompt=select_account+consent`));
      const back = new URL(res.headers.get('location')!).searchParams.get('redirect')!;
      expect(back).toContain('prompt=consent');
      expect(back).not.toContain('select_account');
    });

    it('none answers login_required instead of showing a page', async () => {
      (verifyToken as any).mockImplementation(() => { throw new Error('invalid'); });
      const res = await GET(makeRequest(`${base}&prompt=none`));
      const location = res.headers.get('location')!;
      expect(location).toContain('https://example.com/cb');
      expect(location).toContain('error=login_required');
    });

    it('none answers consent_required when not yet approved', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
      const res = await GET(makeRequest(`${base}&prompt=none`, signedIn));
      expect(res.headers.get('location')).toContain('error=consent_required');
    });

    it('none still issues a code silently when approved', async () => {
      const res = await GET(makeRequest(`${base}&prompt=none`, signedIn));
      expect(res.headers.get('location')).toContain('code=');
    });
  });
});

describe('POST /api/oauth/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  });

  it('should reject unauthenticated consent', async () => {
    (validateClient as any).mockResolvedValue({ valid: true, client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test' } });
    (verifyToken as any).mockImplementation(() => { throw new Error('invalid'); });

    const req = makeRequest('https://coinpay.dev/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: 'cp_test',
        redirect_uri: 'https://example.com/cb',
        scope: 'openid',
        action: 'approve',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('should return JSON redirect URL on denial (not a redirect response)', async () => {
    (validateClient as any).mockResolvedValue({ valid: true, client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test' } });
    (verifyToken as any).mockReturnValue({ userId: 'user-123', email: 'test@example.com' });

    const req = makeRequest('https://coinpay.dev/api/oauth/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        client_id: 'cp_test',
        redirect_uri: 'https://example.com/cb',
        scope: 'openid',
        state: 'mystate',
        action: 'deny',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirect).toContain('https://example.com/cb');
    expect(body.redirect).toContain('error=access_denied');
    expect(body.redirect).toContain('state=mystate');
  });

  it('should return redirect URL on approval', async () => {
    (validateClient as any).mockResolvedValue({ valid: true, client: { client_secret: 'bcrypt-hash', require_pkce: false, legacy_oauth2: true, client_id: 'cp_test' } });
    (verifyToken as any).mockReturnValue({ userId: 'user-123', email: 'test@example.com' });

    const req = makeRequest('https://coinpay.dev/api/oauth/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        client_id: 'cp_test',
        redirect_uri: 'https://example.com/cb',
        scope: 'openid profile',
        state: 'mystate',
        action: 'approve',
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(body.redirect).toContain('https://example.com/cb');
    expect(body.redirect).toContain('code=');
    expect(body.redirect).toContain('state=mystate');
  });
});
