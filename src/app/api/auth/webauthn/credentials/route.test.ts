/**
 * Tests for WebAuthn credentials management route
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDelete = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(() => ({ error: null })),
  })),
}));

const mockUpdate = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => ({
          data: { id: 'cred-1', name: 'Renamed', device_type: 'platform', transports: ['internal'], created_at: '2026-01-01', last_used_at: null },
          error: null,
        })),
      })),
    })),
  })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            data: [
              { id: 'cred-1', name: 'My Passkey', device_type: 'platform', transports: ['internal'], created_at: '2026-01-01', last_used_at: null },
            ],
            error: null,
          })),
        })),
      })),
      delete: mockDelete,
      update: mockUpdate,
    })),
  })),
}));

const mockGetAuthUser = vi.fn();
vi.mock('@/lib/oauth/auth', () => ({
  getAuthUser: (...args: any[]) => mockGetAuthUser(...args),
}));

import { GET, DELETE, PATCH } from './route';
import { NextRequest } from 'next/server';

describe('WebAuthn Credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  describe('GET', () => {
    it('returns 401 if not authenticated', async () => {
      mockGetAuthUser.mockReturnValue(null);
      const req = new NextRequest('http://localhost/api/auth/webauthn/credentials');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns credentials list', async () => {
      mockGetAuthUser.mockReturnValue({ id: 'user-123' });
      const req = new NextRequest('http://localhost/api/auth/webauthn/credentials');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.credentials).toHaveLength(1);
      expect(data.credentials[0].name).toBe('My Passkey');
    });
  });

  describe('DELETE', () => {
    it('returns 400 if missing id', async () => {
      mockGetAuthUser.mockReturnValue({ id: 'user-123' });
      const req = new NextRequest('http://localhost/api/auth/webauthn/credentials', { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('deletes credential', async () => {
      mockGetAuthUser.mockReturnValue({ id: 'user-123' });
      const req = new NextRequest('http://localhost/api/auth/webauthn/credentials?id=cred-1', { method: 'DELETE' });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('PATCH', () => {
    it('renames credential', async () => {
      mockGetAuthUser.mockReturnValue({ id: 'user-123' });
      const req = new NextRequest('http://localhost/api/auth/webauthn/credentials', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'cred-1', name: 'Renamed' }),
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.credential.name).toBe('Renamed');
    });
  });
});
