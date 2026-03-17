/**
 * Tests for WebAuthn register-verify route
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() => ({
      data: { id: 'cred-1', name: 'My Passkey', device_type: 'platform', created_at: new Date().toISOString() },
      error: null,
    })),
  })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: mockInsert,
    })),
  })),
}));

vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'credential-id-123',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
      },
      credentialDeviceType: 'multiDevice',
    },
  })),
}));

vi.mock('@simplewebauthn/server/helpers', () => ({
  isoBase64URL: {
    fromBuffer: vi.fn(() => 'base64-public-key'),
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('@/lib/oauth/auth', () => ({
  getAuthUser: (...args: any[]) => mockGetAuthUser(...args),
}));

const mockConsumeChallenge = vi.fn();
vi.mock('@/lib/webauthn/challenges', () => ({
  consumeChallenge: (...args: any[]) => mockConsumeChallenge(...args),
}));

vi.mock('@/lib/webauthn/config', () => ({
  getRpId: vi.fn(() => 'coinpayportal.com'),
  getOrigin: vi.fn(() => 'https://coinpayportal.com'),
}));

import { POST } from './route';
import { NextRequest } from 'next/server';

describe('WebAuthn Register Verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('returns 401 if not authenticated', async () => {
    mockGetAuthUser.mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify({ credential: {} }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 if challenge expired', async () => {
    mockGetAuthUser.mockReturnValue({ id: 'user-123' });
    mockConsumeChallenge.mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify({ credential: { id: 'test', response: {} } }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Challenge expired');
  });

  it('stores credential on successful verification', async () => {
    mockGetAuthUser.mockReturnValue({ id: 'user-123' });
    mockConsumeChallenge.mockReturnValue('test-challenge');

    const req = new NextRequest('http://localhost/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify({
        credential: {
          id: 'credential-id-123',
          rawId: 'credential-id-123',
          type: 'public-key',
          response: {
            clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
            attestationObject: 'o2NmbXRkbm9uZQ',
            transports: ['internal'],
          },
        },
        name: 'My Passkey',
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.credential).toBeDefined();
    expect(mockInsert).toHaveBeenCalled();
  });
});
