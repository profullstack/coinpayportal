import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initSecrets,
  getSecret,
  hasSecret,
  getSecretStats,
  clearSecrets,
  getJwtSecret,
  getWebhookSecret,
  getEncryptionKey,
  getMnemonic,
} from './index';

describe('Secrets Module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset state between tests
    clearSecrets();
    // Restore original env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    clearSecrets();
    process.env = originalEnv;
  });

  describe('initSecrets', () => {
    it('should load secrets from process.env', () => {
      process.env.JWT_SECRET = 'test-jwt-secret';
      process.env.WEBHOOK_SECRET = 'test-webhook-secret';

      initSecrets();

      expect(getSecret('JWT_SECRET')).toBe('test-jwt-secret');
      expect(getSecret('WEBHOOK_SECRET')).toBe('test-webhook-secret');
    });

    it('should clear secrets from process.env after loading', () => {
      process.env.JWT_SECRET = 'test-jwt-secret';

      initSecrets();

      // Secret should be cleared from process.env
      expect(process.env.JWT_SECRET).toBeUndefined();
      // But still accessible via getSecret
      expect(getSecret('JWT_SECRET')).toBe('test-jwt-secret');
    });

    it('should not reinitialize if already initialized', () => {
      process.env.JWT_SECRET = 'first-secret';
      initSecrets();

      process.env.JWT_SECRET = 'second-secret';
      initSecrets(); // Should be ignored

      // Should still have the first value
      expect(getSecret('JWT_SECRET')).toBe('first-secret');
    });
  });

  describe('getSecret', () => {
    it('should return undefined for unset secrets', () => {
      initSecrets();
      expect(getSecret('COINPAY_MNEMONIC')).toBeUndefined();
    });

    it('should fall back to process.env when not initialized', () => {
      // Don't call initSecrets
      process.env.JWT_SECRET = 'env-secret';
      
      expect(getSecret('JWT_SECRET')).toBe('env-secret');
    });

    it('should track access count', () => {
      process.env.JWT_SECRET = 'test-secret';
      initSecrets();

      getSecret('JWT_SECRET');
      getSecret('JWT_SECRET');
      getSecret('JWT_SECRET');

      const stats = getSecretStats();
      expect(stats['JWT_SECRET'].accessCount).toBe(3);
    });
  });

  describe('hasSecret', () => {
    it('should return true for configured secrets', () => {
      process.env.JWT_SECRET = 'test';
      initSecrets();

      expect(hasSecret('JWT_SECRET')).toBe(true);
    });

    it('should return false for unconfigured secrets', () => {
      initSecrets();
      expect(hasSecret('COINPAY_MNEMONIC')).toBe(false);
    });
  });

  describe('clearSecrets', () => {
    it('should remove all secrets from memory', () => {
      process.env.JWT_SECRET = 'test';
      initSecrets();

      expect(getSecret('JWT_SECRET')).toBe('test');

      clearSecrets();

      // After clearing, falls back to process.env (which was also cleared)
      expect(getSecret('JWT_SECRET')).toBeUndefined();
    });
  });

  describe('convenience helpers', () => {
    describe('getJwtSecret', () => {
      it('should return JWT secret when set', () => {
        process.env.JWT_SECRET = 'my-jwt-secret';
        expect(getJwtSecret()).toBe('my-jwt-secret');
      });

      it('should throw when JWT secret is not set', () => {
        delete process.env.JWT_SECRET;
        expect(() => getJwtSecret()).toThrow('JWT_SECRET environment variable is required');
      });
    });

    describe('getWebhookSecret', () => {
      it('should return webhook secret when set', () => {
        process.env.WEBHOOK_SECRET = 'my-webhook-secret';
        expect(getWebhookSecret()).toBe('my-webhook-secret');
      });

      it('should return undefined when not set', () => {
        delete process.env.WEBHOOK_SECRET;
        expect(getWebhookSecret()).toBeUndefined();
      });
    });

    describe('getEncryptionKey', () => {
      it('should return encryption key when set', () => {
        process.env.ENCRYPTION_KEY = 'my-encryption-key';
        expect(getEncryptionKey()).toBe('my-encryption-key');
      });

      it('should throw when encryption key is not set', () => {
        delete process.env.ENCRYPTION_KEY;
        expect(() => getEncryptionKey()).toThrow('ENCRYPTION_KEY environment variable is required');
      });
    });

    describe('getMnemonic', () => {
      it('should return mnemonic when set', () => {
        process.env.COINPAY_MNEMONIC = 'word word word';
        expect(getMnemonic()).toBe('word word word');
      });

      it('should return undefined when not set', () => {
        delete process.env.COINPAY_MNEMONIC;
        expect(getMnemonic()).toBeUndefined();
      });
    });
  });
});
