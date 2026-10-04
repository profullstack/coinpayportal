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

    // NEW-07: the key used to be the merchant's own id. The challenge store
    // holds one entry per key and this route is public, so anyone who knew a
    // merchant's email could overwrite that merchant's pending challenge and
    // lock them out of their own account for as long as they kept posting.
    // The key is only a lookup handle — login-verify derives the user from the
    // stored credential, never from this value — so it must not identify
    // anyone, and two requests must never collide.
    expect(data._challengeKey).not.toBe('user-123');
    expect(data._challengeKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('issues a distinct challenge key per request for the same email', async () => {
    const call = async () => {
      const req = new NextRequest('http://localhost/api/auth/webauthn/login-options', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      });
      return (await (await POST(req)).json())._challengeKey;
    };

    // Two honest logins from two devices used to share one slot and break each
    // other; this is the same property that denies the attack above.
    expect(await call()).not.toBe(await call());
  });
});
