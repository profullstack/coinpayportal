/**
 * Tests for WebAuthn login-verify route
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn(() => ({
  eq: vi.fn(() => ({})),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'webauthn_credentials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({
                data: {
                  id: 'cred-uuid',
                  user_id: 'user-123',
                  credential_id: 'credential-id-abc',
                  public_key: 'AQID',
                  counter: 0,
                  transports: ['internal'],
                },
                error: null,
              })),
            })),
          })),
          update: mockUpdate,
        };
      }
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({
                data: { id: 'user-123', email: 'test@example.com', is_admin: false },
                error: null,
              })),
            })),
          })),
        };
      }
      return {};
    }),
  })),
}));

vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
}));

vi.mock('@simplewebauthn/server/helpers', () => ({
  isoBase64URL: {
    toBuffer: vi.fn(() => new Uint8Array([1, 2, 3])),
  },
}));

const mockConsumeChallenge = vi.fn();
vi.mock('@/lib/webauthn/challenges', () => ({
  consumeChallenge: (...args: any[]) => mockConsumeChallenge(...args),
}));

vi.mock('@/lib/webauthn/config', () => ({
  getRpId: vi.fn(() => 'coinpayportal.com'),
  getOrigin: vi.fn(() => 'https://coinpayportal.com'),
}));

vi.mock('@/lib/auth/jwt', () => ({
  generateToken: vi.fn(() => 'jwt-token-xyz'),
}));

import { POST } from './route';
import { NextRequest } from 'next/server';

describe('WebAuthn Login Verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  it('returns 400 if missing credential', async () => {
    const req = new NextRequest('http://localhost/api/auth/webauthn/login-verify', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 if challenge expired', async () => {
    mockConsumeChallenge.mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/auth/webauthn/login-verify', {
      method: 'POST',
      body: JSON.stringify({
        credential: { id: 'credential-id-abc', response: {} },
        challengeKey: 'user-123',
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Challenge expired');
  });

  it('returns JWT on successful authentication', async () => {
    mockConsumeChallenge.mockReturnValue('auth-challenge');

    const req = new NextRequest('http://localhost/api/auth/webauthn/login-verify', {
      method: 'POST',
      body: JSON.stringify({
        credential: {
          id: 'credential-id-abc',
          rawId: 'credential-id-abc',
          type: 'public-key',
          response: {
            clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
            authenticatorData: 'auth-data',
            signature: 'signature-data',
          },
        },
        challengeKey: 'user-123',
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.token).toBe('jwt-token-xyz');
    expect(data.merchant.email).toBe('test@example.com');
  });
});
