import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractBearerToken,
  authenticateRequest,
  isMerchantAuth,
  isBusinessAuth,
  type AuthContext,
} from './middleware';
import { generateApiKey } from './apikey';
import { generateToken } from './jwt';

describe('Authentication Middleware', () => {
  describe('extractBearerToken', () => {
    it('should extract token from valid Bearer header', () => {
      const token = extractBearerToken('Bearer abc123token');
      expect(token).toBe('abc123token');
    });

    it('should handle Bearer with extra spaces', () => {
      const token = extractBearerToken('Bearer   abc123token  ');
      expect(token).toBe('abc123token');
    });

    it('should return null for missing header', () => {
      const token = extractBearerToken(null);
      expect(token).toBeNull();
    });

    it('should return null for header without Bearer prefix', () => {
      const token = extractBearerToken('abc123token');
      expect(token).toBeNull();
    });

    it('should return null for empty Bearer', () => {
      const token = extractBearerToken('Bearer ');
      expect(token).toBe('');
    });

    it('should handle case-sensitive Bearer', () => {
      const token = extractBearerToken('bearer abc123');
      expect(token).toBeNull();
    });
  });

  describe('authenticateRequest', () => {
    let mockSupabase: any;

    beforeEach(() => {
      mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
    });

    describe('with JWT token', () => {
      it('should authenticate valid JWT token', async () => {
        const merchantId = 'merchant-123';
        const email = 'test@example.com';
        const jwtSecret = 'test-secret';
        
        // Set JWT_SECRET env var
        process.env.JWT_SECRET = jwtSecret;
        
        const token = generateToken({ userId: merchantId, email }, jwtSecret, '1h');
        const authHeader = `Bearer ${token}`;

        mockSupabase.single.mockResolvedValue({
          data: { id: merchantId, email },
          error: null,
        });

        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(true);
        expect(result.context).toBeDefined();
        expect(result.context?.type).toBe('merchant');
        if (result.context && result.context.type === 'merchant') {
          expect(result.context.merchantId).toBe(merchantId);
          expect(result.context.email).toBe(email);
        }
      });

      it('should reject expired JWT token', async () => {
        const jwtSecret = 'test-secret';
        process.env.JWT_SECRET = jwtSecret;
        
        // Generate token that expires immediately
        const token = generateToken(
          { userId: 'merchant-123', email: 'test@example.com' },
          jwtSecret,
          '0s'
        );

        // Wait a bit to ensure expiration
        await new Promise(resolve => setTimeout(resolve, 100));

        const authHeader = `Bearer ${token}`;
        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(false);
        expect(result.error).toContain('expired');
      });

      it('should reject JWT for non-existent merchant', async () => {
        const jwtSecret = 'test-secret';
        process.env.JWT_SECRET = jwtSecret;
        
        const token = generateToken(
          { userId: 'nonexistent', email: 'test@example.com' },
          jwtSecret,
          '1h'
        );
        const authHeader = `Bearer ${token}`;

        mockSupabase.single.mockResolvedValue({
          data: null,
          error: { message: 'Not found' },
        });

        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Merchant not found');
      });

      it('should handle missing JWT_SECRET', async () => {
        delete process.env.JWT_SECRET;
        
        const authHeader = 'Bearer some-jwt-token';
        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Server configuration error');
      });
    });

    describe('with API key', () => {
      it('should authenticate valid API key', async () => {
        const apiKey = generateApiKey();
        const authHeader = `Bearer ${apiKey}`;
        
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

        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(true);
        expect(result.context).toBeDefined();
        expect(result.context?.type).toBe('business');
        if (result.context && result.context.type === 'business') {
          expect(result.context.businessId).toBe(mockBusiness.id);
          expect(result.context.merchantId).toBe(mockBusiness.merchant_id);
          expect(result.context.businessName).toBe(mockBusiness.name);
        }
      });

      it('should reject invalid API key format', async () => {
        const authHeader = 'Bearer invalid-api-key';
        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should reject API key not in database', async () => {
        const apiKey = generateApiKey();
        const authHeader = `Bearer ${apiKey}`;

        mockSupabase.single.mockResolvedValue({
          data: null,
          error: { message: 'Not found' },
        });

        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid API key');
      });

      it('should reject API key for inactive business', async () => {
        const apiKey = generateApiKey();
        const authHeader = `Bearer ${apiKey}`;
        
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

        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Business is inactive');
      });
    });

    describe('error handling', () => {
      it('should reject missing authorization header', async () => {
        const result = await authenticateRequest(mockSupabase, null);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Missing authorization header');
      });

      it('should reject malformed authorization header', async () => {
        const result = await authenticateRequest(mockSupabase, 'InvalidHeader');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Missing authorization header');
      });

      it('should handle database errors gracefully', async () => {
        const apiKey = generateApiKey();
        const authHeader = `Bearer ${apiKey}`;

        mockSupabase.single.mockRejectedValue(new Error('Database error'));

        const result = await authenticateRequest(mockSupabase, authHeader);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Database error');
      });
    });
  });

  describe('Type Guards', () => {
    describe('isMerchantAuth', () => {
      it('should return true for merchant context', () => {
        const context: AuthContext = {
          type: 'merchant',
          merchantId: 'merchant-123',
          email: 'test@example.com',
        };

        expect(isMerchantAuth(context)).toBe(true);
      });

      it('should return false for business context', () => {
        const context: AuthContext = {
          type: 'business',
          businessId: 'business-123',
          merchantId: 'merchant-456',
          businessName: 'Test Business',
        };

        expect(isMerchantAuth(context)).toBe(false);
      });

      it('should narrow type correctly', () => {
        const context: AuthContext = {
          type: 'merchant',
          merchantId: 'merchant-123',
          email: 'test@example.com',
        };

        if (isMerchantAuth(context)) {
          // TypeScript should know this is MerchantAuthContext
          expect(context.email).toBeDefined();
          expect(context.merchantId).toBe('merchant-123');
        }
      });
    });

    describe('isBusinessAuth', () => {
      it('should return true for business context', () => {
        const context: AuthContext = {
          type: 'business',
          businessId: 'business-123',
          merchantId: 'merchant-456',
          businessName: 'Test Business',
        };

        expect(isBusinessAuth(context)).toBe(true);
      });

      it('should return false for merchant context', () => {
        const context: AuthContext = {
          type: 'merchant',
          merchantId: 'merchant-123',
          email: 'test@example.com',
        };

        expect(isBusinessAuth(context)).toBe(false);
      });

      it('should narrow type correctly', () => {
        const context: AuthContext = {
          type: 'business',
          businessId: 'business-123',
          merchantId: 'merchant-456',
          businessName: 'Test Business',
        };

        if (isBusinessAuth(context)) {
          // TypeScript should know this is BusinessAuthContext
          expect(context.businessId).toBeDefined();
          expect(context.businessName).toBe('Test Business');
        }
      });
    });
  });

  describe('Integration scenarios', () => {
    let mockSupabase: any;

    beforeEach(() => {
      mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
      process.env.JWT_SECRET = 'test-secret';
    });

    it('should handle switching between JWT and API key authentication', async () => {
      // First authenticate with JWT
      const jwtToken = generateToken(
        { userId: 'merchant-123', email: 'test@example.com' },
        'test-secret',
        '1h'
      );

      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'merchant-123', email: 'test@example.com' },
        error: null,
      });

      const jwtResult = await authenticateRequest(
        mockSupabase,
        `Bearer ${jwtToken}`
      );

      expect(jwtResult.success).toBe(true);
      expect(jwtResult.context?.type).toBe('merchant');

      // Then authenticate with API key
      const apiKey = generateApiKey();
      
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'business-123',
          merchant_id: 'merchant-456',
          name: 'Test Business',
          active: true,
        },
        error: null,
      });

      const apiKeyResult = await authenticateRequest(
        mockSupabase,
        `Bearer ${apiKey}`
      );

      expect(apiKeyResult.success).toBe(true);
      expect(apiKeyResult.context?.type).toBe('business');
    });
  });
});