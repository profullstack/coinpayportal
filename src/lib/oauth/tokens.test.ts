import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  generateAuthorizationCode,
  generateRefreshToken,
  generateAccessToken,
  generateIdToken,
  verifyAccessToken,
  validatePKCE,
} from './tokens';

const TEST_SECRET = 'test-oidc-signing-secret-for-unit-tests-min-32';

describe('OAuth Tokens', () => {
  beforeEach(() => {
    vi.stubEnv('OIDC_SIGNING_SECRET', TEST_SECRET);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://coinpay.dev');
  });

  describe('generateAuthorizationCode', () => {
    it('should generate a 64-char hex string', () => {
      const code = generateAuthorizationCode();
      expect(code).toHaveLength(64);
      expect(code).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique codes', () => {
      const codes = new Set(Array.from({ length: 10 }, () => generateAuthorizationCode()));
      expect(codes.size).toBe(10);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a 64-char hex string', () => {
      const token = generateRefreshToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set(Array.from({ length: 10 }, () => generateRefreshToken()));
      expect(tokens.size).toBe(10);
    });
  });

  describe('generateAccessToken', () => {
    it('should generate a valid JWT', () => {
      const token = generateAccessToken(
        { id: 'user-123', email: 'test@example.com' },
        { client_id: 'cp_test' },
        ['openid', 'profile']
      );

      expect(token.split('.')).toHaveLength(3);
    });

    it('should contain correct claims', () => {
      const token = generateAccessToken(
        { id: 'user-123', email: 'test@example.com' },
        { client_id: 'cp_test' },
        ['openid', 'profile', 'email']
      );

      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.sub).toBe('user-123');
      expect(decoded.client_id).toBe('cp_test');
      expect(decoded.scope).toBe('openid profile email');
      expect(decoded.token_type).toBe('access');
      expect(decoded.iss).toBe('https://coinpay.dev');
      expect(decoded.exp).toBeDefined();
    });
  });

  describe('generateIdToken', () => {
    it('should contain OIDC claims', () => {
      const token = generateIdToken(
        { id: 'user-123', email: 'test@example.com', name: 'Test User', picture: 'https://example.com/pic.jpg' },
        { client_id: 'cp_test' },
        ['openid', 'profile', 'email'],
        'test-nonce-123'
      );

      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.sub).toBe('user-123');
      expect(decoded.iss).toBe('https://coinpay.dev');
      expect(decoded.aud).toBe('cp_test');
      expect(decoded.nonce).toBe('test-nonce-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.email_verified).toBe(true);
      expect(decoded.name).toBe('Test User');
      expect(decoded.picture).toBe('https://example.com/pic.jpg');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should omit nonce when not provided', () => {
      const token = generateIdToken(
        { id: 'user-123' },
        { client_id: 'cp_test' },
        ['openid']
      );

      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.nonce).toBeUndefined();
    });

    it('should only include email claims when email scope is present', () => {
      const token = generateIdToken(
        { id: 'user-123', email: 'test@example.com' },
        { client_id: 'cp_test' },
        ['openid', 'profile'] // no email scope
      );

      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBeUndefined();
    });

    it('should only include profile claims when profile scope is present', () => {
      const token = generateIdToken(
        { id: 'user-123', name: 'Test User' },
        { client_id: 'cp_test' },
        ['openid', 'email'] // no profile scope
      );

      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.name).toBeUndefined();
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid access token', () => {
      const token = generateAccessToken(
        { id: 'user-123' },
        { client_id: 'cp_test' },
        ['openid']
      );

      const decoded = verifyAccessToken(token);
      expect(decoded.sub).toBe('user-123');
      expect(decoded.token_type).toBe('access');
    });

    it('should reject expired tokens', () => {
      const token = jwt.sign(
        { sub: 'user-123', token_type: 'access', scope: 'openid' },
        TEST_SECRET,
        { algorithm: 'HS256', expiresIn: '-1h' }
      );

      expect(() => verifyAccessToken(token)).toThrow('Token has expired');
    });

    it('should reject invalid tokens', () => {
      expect(() => verifyAccessToken('not.a.valid.token')).toThrow('Invalid token');
    });

    it('should reject tokens signed with wrong secret', () => {
      const token = jwt.sign(
        { sub: 'user-123', token_type: 'access' },
        'wrong-secret',
        { algorithm: 'HS256' }
      );

      expect(() => verifyAccessToken(token)).toThrow('Invalid token');
    });
  });

  describe('validatePKCE', () => {
    it('should validate S256 challenge correctly', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      expect(validatePKCE(verifier, challenge, 'S256')).toBe(true);
    });

    it('should reject wrong verifier for S256', () => {
      const verifier = 'correct-verifier';
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      expect(validatePKCE('wrong-verifier', challenge, 'S256')).toBe(false);
    });

    it('should validate plain challenge correctly', () => {
      const verifier = 'plain-code-verifier';
      expect(validatePKCE(verifier, verifier, 'plain')).toBe(true);
    });

    it('should reject wrong plain verifier', () => {
      expect(validatePKCE('wrong', 'correct', 'plain')).toBe(false);
    });

    it('should reject unknown method', () => {
      expect(validatePKCE('verifier', 'challenge', 'unknown')).toBe(false);
    });
  });
});
