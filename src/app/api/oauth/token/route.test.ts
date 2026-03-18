import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

// Mock Supabase
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) }));
const mockSingle = vi.fn();
const mockEq3 = vi.fn(() => ({ single: mockSingle }));
const mockEq2 = vi.fn(() => ({ single: mockSingle, eq: mockEq3 }));
const mockEq1 = vi.fn(() => ({ single: mockSingle, eq: mockEq2 }));
const mockSelect = vi.fn(() => ({ eq: mockEq1 }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'oauth_authorization_codes') {
        return {
          select: mockSelect,
          update: mockUpdate,
        };
      }
      if (table === 'oauth_refresh_tokens') {
        return {
          select: mockSelect,
          insert: mockInsert,
          update: mockUpdate,
        };
      }
      if (table === 'merchants') {
        return { select: mockSelect };
      }
      return { select: mockSelect, insert: mockInsert };
    }),
  })),
}));

vi.mock('@/lib/oauth/client', () => ({
  authenticateClient: vi.fn(),
}));

import { POST } from './route';
import { authenticateClient } from '@/lib/oauth/client';

const TEST_SECRET = 'test-oidc-signing-secret-for-unit-tests-min-32';

function makeFormRequest(body: Record<string, string>, headers?: Record<string, string>): any {
  const params = new URLSearchParams(body);
  return new Request('https://coinpay.dev/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: params.toString(),
  });
}

function makeJsonRequest(body: Record<string, string>): any {
  return new Request('https://coinpay.dev/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/oauth/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OIDC_SIGNING_SECRET', TEST_SECRET);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://coinpay.dev');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  });

  it('should reject unsupported grant_type', async () => {
    const req = makeFormRequest({ grant_type: 'implicit' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_grant_type');
  });

  describe('authorization_code grant', () => {
    const validCodeData = {
      id: 'code-id-123',
      code: 'valid-code',
      client_id: 'cp_test',
      user_id: 'user-123',
      redirect_uri: 'https://example.com/cb',
      scopes: ['openid', 'profile', 'email'],
      code_challenge: null,
      code_challenge_method: null,
      nonce: 'test-nonce',
      expires_at: new Date(Date.now() + 600000).toISOString(),
      used: false,
    };

    it('should exchange valid code for tokens', async () => {
      (authenticateClient as any).mockResolvedValue({ valid: true, client: { client_id: 'cp_test' } });

      let callCount = 0;
      mockSingle.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: validCodeData, error: null });
        return Promise.resolve({ data: { id: 'user-123', email: 'test@example.com', name: 'Test', email_verified: true }, error: null });
      });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
        client_secret: 'cps_secret',
      });

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBe(3600);
      expect(body.refresh_token).toBeDefined();
      expect(body.id_token).toBeDefined();
      expect(body.scope).toBe('openid profile email');

      const decoded = jwt.verify(body.access_token, TEST_SECRET) as any;
      expect(decoded.sub).toBe('user-123');
    });

    it('should reject expired code', async () => {
      let callCount = 0;
      mockSingle.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              ...validCodeData,
              expires_at: new Date(Date.now() - 1000).toISOString(),
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'expired-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
        client_secret: 'cps_secret',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_grant');
      expect(body.error_description).toContain('expired');
    });

    it('should reject used code', async () => {
      mockSingle.mockResolvedValue({
        data: {
          ...validCodeData,
          used: true,
        },
        error: null,
      });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'used-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
        client_secret: 'cps_secret',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_grant');
      expect(body.error_description).toContain('already been used');
    });

    it('should reject wrong client_secret', async () => {
      mockSingle.mockResolvedValue({
        data: validCodeData,
        error: null,
      });

      (authenticateClient as any).mockResolvedValue({ valid: false, error: 'Invalid client credentials' });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
        client_secret: 'wrong-secret',
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_client');
    });

    it('should reject wrong redirect_uri', async () => {
      mockSingle.mockResolvedValue({
        data: validCodeData,
        error: null,
      });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        redirect_uri: 'https://wrong.com/cb',
        client_id: 'cp_test',
        client_secret: 'cps_secret',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_grant');
      expect(body.error_description).toContain('Redirect URI mismatch');
    });

    it('should validate PKCE and succeed with correct verifier', async () => {
      const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      let callCount = 0;
      mockSingle.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: { ...validCodeData, code_challenge: codeChallenge, code_challenge_method: 'S256' },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'user-123', email: 'test@example.com' }, error: null });
      });

      // PKCE flow — no client_secret needed
      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'pkce-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
        code_verifier: codeVerifier,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.access_token).toBeDefined();
    });

    it('should reject PKCE with wrong verifier', async () => {
      const codeChallenge = createHash('sha256')
        .update('correct-verifier')
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      mockSingle.mockResolvedValue({
        data: { ...validCodeData, code_challenge: codeChallenge, code_challenge_method: 'S256' },
        error: null,
      });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'pkce-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
        code_verifier: 'wrong-verifier',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_grant');
      expect(body.error_description).toContain('PKCE');
    });

    it('should require code_verifier when code_challenge was set', async () => {
      mockSingle.mockResolvedValue({
        data: { ...validCodeData, code_challenge: 'some-challenge', code_challenge_method: 'S256' },
        error: null,
      });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'pkce-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_description).toContain('code_verifier');
    });

    it('should require client_secret for confidential clients (no PKCE)', async () => {
      // Code has no code_challenge — confidential client flow
      mockSingle.mockResolvedValue({
        data: validCodeData, // code_challenge: null
        error: null,
      });

      const req = makeFormRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        redirect_uri: 'https://example.com/cb',
        client_id: 'cp_test',
        // no client_secret
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_client');
      expect(body.error_description).toContain('client_secret is required');
    });

    it('should support client_secret_basic authentication', async () => {
      (authenticateClient as any).mockResolvedValue({ valid: true, client: { client_id: 'cp_test' } });

      let callCount = 0;
      mockSingle.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: validCodeData, error: null });
        return Promise.resolve({ data: { id: 'user-123', email: 'test@example.com', name: 'Test' }, error: null });
      });

      const basicAuth = Buffer.from('cp_test:cps_secret').toString('base64');
      const req = makeFormRequest(
        {
          grant_type: 'authorization_code',
          code: 'valid-code',
          redirect_uri: 'https://example.com/cb',
          // client_id and client_secret come from Basic auth header
        },
        { authorization: `Basic ${basicAuth}` }
      );

      const res = await POST(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.access_token).toBeDefined();

      // Verify authenticateClient was called with credentials from Basic auth
      expect(authenticateClient).toHaveBeenCalledWith('cp_test', 'cps_secret');
    });
  });

  describe('refresh_token grant', () => {
    it('should issue new tokens with valid refresh token', async () => {
      (authenticateClient as any).mockResolvedValue({ valid: true });

      let callCount = 0;
      mockSingle.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              id: 'rt-id',
              token: 'valid-refresh',
              client_id: 'cp_test',
              user_id: 'user-123',
              scopes: ['openid', 'profile'],
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              revoked: false,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'user-123', email: 'test@example.com' }, error: null });
      });

      const req = makeFormRequest({
        grant_type: 'refresh_token',
        refresh_token: 'valid-refresh',
        client_id: 'cp_test',
        client_secret: 'cps_secret',
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.token_type).toBe('Bearer');
    });

    it('should reject invalid refresh token', async () => {
      (authenticateClient as any).mockResolvedValue({ valid: true });
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const req = makeFormRequest({
        grant_type: 'refresh_token',
        refresh_token: 'invalid-refresh',
        client_id: 'cp_test',
        client_secret: 'cps_secret',
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_grant');
    });
  });
});
