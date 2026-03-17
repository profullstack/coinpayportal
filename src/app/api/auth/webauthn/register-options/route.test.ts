/**
 * Tests for WebAuthn register-options route
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before imports
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => ({
                data: { email: 'test@example.com' },
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
              data: [],
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
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: 'test-challenge-base64',
    rp: { name: 'CoinPay', id: 'coinpayportal.com' },
    user: { id: 'user-id', name: 'test@example.com', displayName: 'test@example.com' },
    pubKeyCredParams: [],
    timeout: 60000,
    attestation: 'none',
  })),
}));

const mockGetAuthUser = vi.fn();
vi.mock('@/lib/oauth/auth', () => ({
  getAuthUser: (...args: any[]) => mockGetAuthUser(...args),
}));

const mockStoreChallenge = vi.fn();
vi.mock('@/lib/webauthn/challenges', () => ({
  storeChallenge: (...args: any[]) => mockStoreChallenge(...args),
}));

vi.mock('@/lib/webauthn/config', () => ({
  getRpId: vi.fn(() => 'coinpayportal.com'),
  getRpName: vi.fn(() => 'CoinPay'),
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

describe('WebAuthn Register Options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('returns 401 if not authenticated', async () => {
    mockGetAuthUser.mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/auth/webauthn/register-options');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
  });

  it('returns registration options for authenticated user', async () => {
    mockGetAuthUser.mockReturnValue({ id: 'user-123' });

    const req = new NextRequest('http://localhost/api/auth/webauthn/register-options');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.options).toBeDefined();
    expect(data.options.challenge).toBe('test-challenge-base64');
    expect(mockStoreChallenge).toHaveBeenCalledWith('user-123', 'test-challenge-base64');
  });
});
