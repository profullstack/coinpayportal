import { describe, it, expect, beforeEach } from 'vitest';
import {
  encrypt,
  decrypt,
  generateEncryptionKey,
  deriveKey,
  hashPassword,
  verifyPassword,
} from './encryption';

describe('Encryption Utilities', () => {
  let testKey: string;

  beforeEach(() => {
    // Generate a test encryption key (32 bytes hex)
    testKey = generateEncryptionKey();
  });

  describe('generateEncryptionKey', () => {
    it('should generate a 32-byte hex key', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64); // 32 bytes = 64 hex characters
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a string successfully', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it('should encrypt and decrypt JSON data', () => {
      const data = { privateKey: 'test-key-123', address: '0x123' };
      const plaintext = JSON.stringify(data);
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(JSON.parse(decrypted)).toEqual(data);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const plaintext = 'test data';
      const encrypted1 = encrypt(plaintext, testKey);
      const encrypted2 = encrypt(plaintext, testKey);
      
      // Different IVs should produce different ciphertext
      expect(encrypted1).not.toBe(encrypted2);
      
      // But both should decrypt to same plaintext
      expect(decrypt(encrypted1, testKey)).toBe(plaintext);
      expect(decrypt(encrypted2, testKey)).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = '🔐 Secure data with émojis and spëcial çhars';
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should throw error with invalid key length', () => {
      const plaintext = 'test';
      const invalidKey = 'short';
      
      expect(() => encrypt(plaintext, invalidKey)).toThrow();
    });

    it('should throw error when decrypting with wrong key', () => {
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext, testKey);
      const wrongKey = generateEncryptionKey();
      
      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });

    it('should throw error with corrupted ciphertext', () => {
      const plaintext = 'test data';
      const encrypted = encrypt(plaintext, testKey);
      const corrupted = encrypted.slice(0, -10) + '0000000000';
      
      expect(() => decrypt(corrupted, testKey)).toThrow();
    });

    it('should handle large data', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('deriveKey', () => {
    it('should derive a key from master key and salt', () => {
      const masterKey = 'master-secret-key';
      const salt = 'unique-salt';
      const derivedKey = deriveKey(masterKey, salt);
      
      expect(derivedKey).toHaveLength(64); // 32 bytes hex
      expect(derivedKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce same key for same inputs', () => {
      const masterKey = 'master-secret-key';
      const salt = 'unique-salt';
      const key1 = deriveKey(masterKey, salt);
      const key2 = deriveKey(masterKey, salt);
      
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different salts', () => {
      const masterKey = 'master-secret-key';
      const key1 = deriveKey(masterKey, 'salt1');
      const key2 = deriveKey(masterKey, 'salt2');
      
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different master keys', () => {
      const salt = 'unique-salt';
      const key1 = deriveKey('master1', salt);
      const key2 = deriveKey('master2', salt);
      
      expect(key1).not.toBe(key2);
    });

    it('should throw error with empty master key', () => {
      expect(() => deriveKey('', 'salt')).toThrow();
    });

    it('should throw error with empty salt', () => {
      expect(() => deriveKey('master', '')).toThrow();
    });
  });

  describe('hashPassword and verifyPassword', () => {
    it('should hash a password', async () => {
      const password = 'SecurePassword123!';
      const hash = await hashPassword(password);
      
      expect(hash).toBeTruthy();
      expect(hash).not.toBe(password);
      expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt hash format
    });

    it('should verify correct password', async () => {
      const password = 'SecurePassword123!';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'SecurePassword123!';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword('WrongPassword', hash);
      
      expect(isValid).toBe(false);
    });

    it('should produce different hashes for same password', async () => {
      const password = 'SecurePassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      // Different salts should produce different hashes
      expect(hash1).not.toBe(hash2);
      
      // But both should verify correctly
      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });

    it('should handle empty password', async () => {
      await expect(hashPassword('')).rejects.toThrow();
    });

    it('should handle very long passwords', async () => {
      const longPassword = 'a'.repeat(100);
      const hash = await hashPassword(longPassword);
      const isValid = await verifyPassword(longPassword, hash);
      
      expect(isValid).toBe(true);
    });

    it('should handle special characters in password', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should handle unicode characters in password', async () => {
      const password = 'Pässwörd123🔐';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should return false for invalid hash format', async () => {
      const password = 'test';
      const invalidHash = 'not-a-valid-hash';
      
      const isValid = await verifyPassword(password, invalidHash);
      expect(isValid).toBe(false);
    });
  });

  describe('Integration: Encrypt with derived key', () => {
    it('should encrypt and decrypt using derived key', () => {
      const masterKey = 'master-secret-key';
      const salt = 'merchant-123';
      const derivedKey = deriveKey(masterKey, salt);
      
      const plaintext = 'sensitive data';
      const encrypted = encrypt(plaintext, derivedKey);
      const decrypted = decrypt(encrypted, derivedKey);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt with different derived key', () => {
      const masterKey = 'master-secret-key';
      const salt1 = 'merchant-123';
      const salt2 = 'merchant-456';
      
      const key1 = deriveKey(masterKey, salt1);
      const key2 = deriveKey(masterKey, salt2);
      
      const plaintext = 'sensitive data';
      const encrypted = encrypt(plaintext, key1);
      
      expect(() => decrypt(encrypted, key2)).toThrow();
    });
  });
});