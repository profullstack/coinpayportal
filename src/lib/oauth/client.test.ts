import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle, eq: mockEq }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

import { validateClient, authenticateClient } from './client';

describe('OAuth Client', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.clearAllMocks();

    // Reset the chain
    mockEq.mockImplementation(() => ({ single: mockSingle, eq: mockEq }));
    mockSelect.mockImplementation(() => ({ eq: mockEq }));
    mockFrom.mockImplementation(() => ({ select: mockSelect }));
  });

  describe('validateClient', () => {
    it('should return valid for active client with matching redirect_uri', async () => {
      mockSingle.mockResolvedValue({
        data: {
          id: '123',
          client_id: 'cp_test',
          client_secret: 'cps_secret',
          name: 'Test App',
          redirect_uris: ['https://example.com/callback'],
          scopes: ['openid', 'profile'],
          is_active: true,
        },
        error: null,
      });

      const result = await validateClient('cp_test', 'https://example.com/callback');
      expect(result.valid).toBe(true);
      expect(result.client).toBeDefined();
      expect(result.client!.name).toBe('Test App');
    });

    it('should reject invalid client_id', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const result = await validateClient('cp_nonexistent', 'https://example.com/callback');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid client_id');
    });

    it('should reject inactive client', async () => {
      mockSingle.mockResolvedValue({
        data: {
          client_id: 'cp_test',
          redirect_uris: ['https://example.com/callback'],
          is_active: false,
        },
        error: null,
      });

      const result = await validateClient('cp_test', 'https://example.com/callback');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Client is inactive');
    });

    it('should reject mismatched redirect_uri', async () => {
      mockSingle.mockResolvedValue({
        data: {
          client_id: 'cp_test',
          redirect_uris: ['https://example.com/callback'],
          is_active: true,
        },
        error: null,
      });

      const result = await validateClient('cp_test', 'https://evil.com/callback');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid redirect_uri');
    });
  });

  describe('authenticateClient', () => {
    it('should authenticate valid client credentials', async () => {
      mockSingle.mockResolvedValue({
        data: {
          client_id: 'cp_test',
          client_secret: 'cps_secret',
          name: 'Test App',
          is_active: true,
        },
        error: null,
      });

      const result = await authenticateClient('cp_test', 'cps_secret');
      expect(result.valid).toBe(true);
      expect(result.client).toBeDefined();
    });

    it('should reject invalid client secret', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const result = await authenticateClient('cp_test', 'wrong_secret');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid client credentials');
    });

    it('should reject inactive client', async () => {
      mockSingle.mockResolvedValue({
        data: {
          client_id: 'cp_test',
          client_secret: 'cps_secret',
          is_active: false,
        },
        error: null,
      });

      const result = await authenticateClient('cp_test', 'cps_secret');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Client is inactive');
    });
  });
});
