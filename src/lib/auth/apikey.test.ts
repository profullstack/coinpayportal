import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateApiKey,
  validateApiKeyFormat,
  getBusinessByApiKey,
  regenerateApiKey,
  isApiKey,
} from './apikey';

describe('API Key Service', () => {
  describe('generateApiKey', () => {
    it('should generate an API key with correct prefix', () => {
      const apiKey = generateApiKey();
      expect(apiKey).toMatch(/^cp_live_/);
    });

    it('should generate an API key with correct length', () => {
      const apiKey = generateApiKey();
      expect(apiKey).toHaveLength(40); // 8 (prefix) + 32 (hex)
    });

    it('should generate unique API keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      const key3 = generateApiKey();
      
      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });

    it('should generate API keys with only hexadecimal characters after prefix', () => {
      const apiKey = generateApiKey();
      const keyPart = apiKey.substring(8); // Remove 'cp_live_' prefix
      expect(keyPart).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should generate cryptographically random keys', () => {
      // Generate multiple keys and ensure they're all different
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      expect(keys.size).toBe(100);
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should validate a correctly formatted API key', () => {
      const validKey = 'cp_live_' + 'a'.repeat(32);
      const result = validateApiKeyFormat(validKey);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject empty API key', () => {
      const result = validateApiKeyFormat('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should reject null API key', () => {
      const result = validateApiKeyFormat(null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should reject API key without correct prefix', () => {
      const result = validateApiKeyFormat('invalid_' + 'a'.repeat(32));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must start with cp_live_');
    });

    it('should reject API key with incorrect length', () => {
      const result = validateApiKeyFormat('cp_live_short');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be 40 characters long');
    });

    it('should reject API key with non-hexadecimal characters', () => {
      const result = validateApiKeyFormat('cp_live_' + 'z'.repeat(32));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid characters');
    });

    it('should accept API key with mixed case hex characters', () => {
      // 32 hex characters with mixed case
      const result = validateApiKeyFormat('cp_live_aAbBcCdDeEfF01234567890123456789');
      expect(result.valid).toBe(true);
    });
  });

  describe('getBusinessByApiKey', () => {
    let mockSupabase: any;

    beforeEach(() => {
      mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
    });

    it('should return business for valid API key', async () => {
      const validKey = generateApiKey();
      const mockBusiness = {
        id: 'business-123',
        merchant_id: 'merchant-456',
        name: 'Test Business',
        active: true,
      };

      mockSupabase.single.mockResolvedValue({
        data: mockBusiness,
        error: null,
      });

      const result = await getBusinessByApiKey(mockSupabase, validKey);

      expect(result.success).toBe(true);
      expect(result.business).toEqual(mockBusiness);
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid API key format', async () => {
      const result = await getBusinessByApiKey(mockSupabase, 'invalid-key');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should reject API key not found in database', async () => {
      const validKey = generateApiKey();

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await getBusinessByApiKey(mockSupabase, validKey);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should reject API key for inactive business', async () => {
      const validKey = generateApiKey();
      const mockBusiness = {
        id: 'business-123',
        merchant_id: 'merchant-456',
        name: 'Test Business',
        active: false,
      };

      mockSupabase.single.mockResolvedValue({
        data: mockBusiness,
        error: null,
      });

      const result = await getBusinessByApiKey(mockSupabase, validKey);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Business is inactive');
    });

    it('should handle database errors gracefully', async () => {
      const validKey = generateApiKey();

      mockSupabase.single.mockRejectedValue(new Error('Database connection failed'));

      const result = await getBusinessByApiKey(mockSupabase, validKey);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
    });
  });

  describe('regenerateApiKey', () => {
    let mockSupabase: any;

    beforeEach(() => {
      mockSupabase = {
        from: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
    });

    it('should generate new API key and update database', async () => {
      const businessId = 'business-123';
      const merchantId = 'merchant-456';
      const mockBusiness = {
        id: businessId,
        merchant_id: merchantId,
        name: 'Test Business',
        active: true,
      };

      mockSupabase.single.mockResolvedValue({
        data: mockBusiness,
        error: null,
      });

      const result = await regenerateApiKey(mockSupabase, businessId, merchantId);

      expect(result.success).toBe(true);
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey).toMatch(/^cp_live_/);
      expect(result.business).toEqual(mockBusiness);
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key: expect.stringMatching(/^cp_live_/),
          api_key_created_at: expect.any(String),
        })
      );
    });

    it('should fail if business not found', async () => {
      const businessId = 'business-123';
      const merchantId = 'merchant-456';

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await regenerateApiKey(mockSupabase, businessId, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail if merchant does not own business', async () => {
      const businessId = 'business-123';
      const wrongMerchantId = 'wrong-merchant';

      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await regenerateApiKey(mockSupabase, businessId, wrongMerchantId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      const businessId = 'business-123';
      const merchantId = 'merchant-456';

      mockSupabase.single.mockRejectedValue(new Error('Database error'));

      const result = await regenerateApiKey(mockSupabase, businessId, merchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });

    it('should generate different keys on multiple regenerations', async () => {
      const businessId = 'business-123';
      const merchantId = 'merchant-456';
      const mockBusiness = {
        id: businessId,
        merchant_id: merchantId,
        name: 'Test Business',
        active: true,
      };

      mockSupabase.single.mockResolvedValue({
        data: mockBusiness,
        error: null,
      });

      const result1 = await regenerateApiKey(mockSupabase, businessId, merchantId);
      const result2 = await regenerateApiKey(mockSupabase, businessId, merchantId);

      expect(result1.apiKey).not.toBe(result2.apiKey);
    });
  });

  describe('isApiKey', () => {
    it('should return true for valid API key format', () => {
      const apiKey = generateApiKey();
      expect(isApiKey(apiKey)).toBe(true);
    });

    it('should return true for any string starting with cp_live_', () => {
      expect(isApiKey('cp_live_anything')).toBe(true);
    });

    it('should return false for JWT token', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      expect(isApiKey(jwtToken)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isApiKey('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isApiKey(null as any)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isApiKey(undefined as any)).toBe(false);
    });

    it('should return false for random string', () => {
      expect(isApiKey('random-string-123')).toBe(false);
    });
  });
});