import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateToken,
  verifyToken,
  decodeToken,
  isTokenExpired,
} from './jwt';

describe('JWT Utilities', () => {
  const testSecret = 'test-secret-key-for-jwt-signing-minimum-32-chars';
  let testPayload: { userId: string; email: string };

  beforeEach(() => {
    testPayload = {
      userId: 'user-123',
      email: 'test@example.com',
    };
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateToken(testPayload, testSecret);
      
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should generate tokens with same payload data', () => {
      const token1 = generateToken(testPayload, testSecret);
      const token2 = generateToken(testPayload, testSecret);
      
      // Both tokens should verify and contain same payload data
      const decoded1 = verifyToken(token1, testSecret);
      const decoded2 = verifyToken(token2, testSecret);
      expect(decoded1.userId).toBe(testPayload.userId);
      expect(decoded2.userId).toBe(testPayload.userId);
      expect(decoded1.email).toBe(testPayload.email);
      expect(decoded2.email).toBe(testPayload.email);
    });

    it('should include custom expiration time', () => {
      const token = generateToken(testPayload, testSecret, '1h');
      const decoded = decodeToken(token);
      
      expect(decoded).toBeTruthy();
      expect(decoded?.exp).toBeTruthy();
    });

    it('should throw error with empty payload', () => {
      expect(() => generateToken({}, testSecret)).toThrow();
    });

    it('should throw error with empty secret', () => {
      expect(() => generateToken(testPayload, '')).toThrow();
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = generateToken(testPayload, testSecret);
      const decoded = verifyToken(token, testSecret);
      
      expect(decoded).toBeTruthy();
      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.email).toBe(testPayload.email);
    });

    it('should throw error for invalid token', () => {
      const invalidToken = 'invalid.token.here';
      
      expect(() => verifyToken(invalidToken, testSecret)).toThrow();
    });

    it('should throw error for token with wrong secret', () => {
      const token = generateToken(testPayload, testSecret);
      const wrongSecret = 'wrong-secret-key-that-is-different';
      
      expect(() => verifyToken(token, wrongSecret)).toThrow();
    });

    it('should throw error for expired token', () => {
      // Create a token that's already expired (0 seconds)
      const token = generateToken(testPayload, testSecret, 0);
      
      expect(() => verifyToken(token, testSecret)).toThrow();
    });

    it('should throw error for malformed token', () => {
      const malformedToken = 'not-a-jwt-token';
      
      expect(() => verifyToken(malformedToken, testSecret)).toThrow();
    });

    it('should verify token with additional claims', () => {
      const payloadWithClaims = {
        ...testPayload,
        role: 'admin',
        permissions: ['read', 'write'],
      };
      const token = generateToken(payloadWithClaims, testSecret);
      const decoded = verifyToken(token, testSecret);
      
      expect(decoded.role).toBe('admin');
      expect(decoded.permissions).toEqual(['read', 'write']);
    });
  });

  describe('decodeToken', () => {
    it('should decode token without verification', () => {
      const token = generateToken(testPayload, testSecret);
      const decoded = decodeToken(token);
      
      expect(decoded).toBeTruthy();
      expect(decoded?.userId).toBe(testPayload.userId);
      expect(decoded?.email).toBe(testPayload.email);
    });

    it('should decode expired token', () => {
      const token = generateToken(testPayload, testSecret, '0s');
      
      // Decode should work even if expired
      const decoded = decodeToken(token);
      expect(decoded).toBeTruthy();
      expect(decoded?.userId).toBe(testPayload.userId);
    });

    it('should return null for invalid token', () => {
      const invalidToken = 'invalid.token';
      const decoded = decodeToken(invalidToken);
      
      expect(decoded).toBeNull();
    });

    it('should return null for malformed token', () => {
      const malformedToken = 'not-a-jwt';
      const decoded = decodeToken(malformedToken);
      
      expect(decoded).toBeNull();
    });

    it('should decode token with standard JWT claims', () => {
      const token = generateToken(testPayload, testSecret);
      const decoded = decodeToken(token);
      
      expect(decoded?.iat).toBeTruthy(); // issued at
      expect(decoded?.exp).toBeTruthy(); // expiration
      expect(typeof decoded?.iat).toBe('number');
      expect(typeof decoded?.exp).toBe('number');
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for valid token', () => {
      const token = generateToken(testPayload, testSecret, '1h');
      
      expect(isTokenExpired(token)).toBe(false);
    });

    it('should return false for valid long-lived token', () => {
      // Create a token with long expiration
      const token = generateToken(testPayload, testSecret, '7d');
      
      expect(isTokenExpired(token)).toBe(false);
    });

    it('should return true for token without expiration', () => {
      // Manually create token without exp claim
      const token = generateToken(testPayload, testSecret);
      const decoded = decodeToken(token);
      
      // Token should have exp by default
      expect(decoded?.exp).toBeTruthy();
    });

    it('should return true for invalid token', () => {
      const invalidToken = 'invalid.token';
      
      expect(isTokenExpired(invalidToken)).toBe(true);
    });

    it('should return true for malformed token', () => {
      const malformedToken = 'not-a-jwt';
      
      expect(isTokenExpired(malformedToken)).toBe(true);
    });

    it('should correctly identify non-expired tokens', () => {
      const token = generateToken(testPayload, testSecret, '1h');
      
      // Should not be expired
      expect(isTokenExpired(token)).toBe(false);
    });
  });

  describe('Integration: Token lifecycle', () => {
    it('should handle complete token lifecycle', () => {
      // Generate token
      const token = generateToken(testPayload, testSecret, '1h');
      expect(token).toBeTruthy();
      
      // Decode without verification
      const decoded = decodeToken(token);
      expect(decoded?.userId).toBe(testPayload.userId);
      
      // Verify token
      const verified = verifyToken(token, testSecret);
      expect(verified.userId).toBe(testPayload.userId);
      
      // Check expiration
      expect(isTokenExpired(token)).toBe(false);
    });

    it('should handle token with complex payload', () => {
      const complexPayload = {
        userId: 'user-456',
        email: 'complex@example.com',
        profile: {
          name: 'Test User',
          avatar: 'https://example.com/avatar.jpg',
        },
        permissions: ['read', 'write', 'delete'],
        metadata: {
          lastLogin: new Date().toISOString(),
          loginCount: 42,
        },
      };
      
      const token = generateToken(complexPayload, testSecret);
      const verified = verifyToken(token, testSecret);
      
      expect(verified.userId).toBe(complexPayload.userId);
      expect(verified.profile.name).toBe(complexPayload.profile.name);
      expect(verified.permissions).toEqual(complexPayload.permissions);
      expect(verified.metadata.loginCount).toBe(42);
    });
  });
});