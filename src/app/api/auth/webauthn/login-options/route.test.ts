/**
 * Tests for WebAuthn login-options route
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({
                data: { id: 'user-123' },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === 'webauthn_credentials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              data: [{ credential_id: 'cred-1', transports: ['internal'] }],
              error: null,
            })),
          })),
        };
      }
      return {};
    }),
  })),
}));

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: 'auth-challenge-base64',
    timeout: 60000,
    rpId: 'coinpayportal.com',
    allowCredentials: [],
  })),
}));

vi.mock('@/lib/webauthn/config', () => ({
  getRpId: vi.fn(() => 'coinpayportal.com'),
}));

const mockStoreChallenge = vi.fn();
vi.mock('@/lib/webauthn/challenges', () => ({
  storeChallenge: (...args: any[]) => mockStoreChallenge(...args),
}));

import { POST } from './route';
import { NextRequest } from 'next/server';

describe('WebAuthn Login Options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('returns authentication options without email', async () => {
    const req = new NextRequest('http://localhost/api/auth/webauthn/login-options', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.options).toBeDefined();
    expect(data._challengeKey).toBeDefined();
    expect(mockStoreChallenge).toHaveBeenCalled();
  });

  it('returns authentication options with email', async () => {
    const req = new NextRequest('http://localhost/api/auth/webauthn/login-options', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data._challengeKey).toBe('user-123');
  });
});
