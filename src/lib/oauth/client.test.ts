import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

// Mock Supabase
const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle, eq: mockEq }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

import { validateClient, authenticateClient, hashClientSecret } from './client';

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
          client_secret: 'hashed_secret',
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
    it('should authenticate valid client credentials with bcrypt', async () => {
      const plainSecret = 'cps_my_secret_value';
      const hashedSecret = await bcrypt.hash(plainSecret, 10);

      mockSingle.mockResolvedValue({
        data: {
          client_id: 'cp_test',
          client_secret: hashedSecret,
          name: 'Test App',
          is_active: true,
        },
        error: null,
      });

      const result = await authenticateClient('cp_test', plainSecret);
      expect(result.valid).toBe(true);
      expect(result.client).toBeDefined();
    });

    it('should reject invalid client secret', async () => {
      const hashedSecret = await bcrypt.hash('correct_secret', 10);

      mockSingle.mockResolvedValue({
        data: {
          client_id: 'cp_test',
          client_secret: hashedSecret,
          is_active: true,
        },
        error: null,
      });

      const result = await authenticateClient('cp_test', 'wrong_secret');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid client credentials');
    });

    it('should reject when client not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const result = await authenticateClient('cp_test', 'wrong_secret');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid client credentials');
    });

    it('should reject inactive client', async () => {
      const hashedSecret = await bcrypt.hash('cps_secret', 10);

      mockSingle.mockResolvedValue({
        data: {
          client_id: 'cp_test',
          client_secret: hashedSecret,
          is_active: false,
        },
        error: null,
      });

      const result = await authenticateClient('cp_test', 'cps_secret');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Client is inactive');
    });
  });

  describe('hashClientSecret', () => {
    it('should return a bcrypt hash', async () => {
      const hash = await hashClientSecret('my_secret');
      expect(hash).toMatch(/^\$2[aby]\$/);
      expect(await bcrypt.compare('my_secret', hash)).toBe(true);
    });

    it('should not match wrong password', async () => {
      const hash = await hashClientSecret('my_secret');
      expect(await bcrypt.compare('wrong_secret', hash)).toBe(false);
    });
  });
});
