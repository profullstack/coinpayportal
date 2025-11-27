import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storeKey,
  retrieveKey,
  keyExists,
  deleteKey,
  updateKey,
  getKeyMetadata,
  listKeyIds,
  clearKeyStore,
  rotateKey,
  storeMultipleKeys,
  deleteMultipleKeys,
} from './keyStorage';

describe('Key Storage Service', () => {
  // Set up environment variable for tests
  beforeEach(() => {
    vi.stubEnv('MASTER_ENCRYPTION_KEY', 'test-master-key-for-encryption-testing');
    clearKeyStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearKeyStore();
  });

  describe('storeKey', () => {
    it('should store a key successfully', async () => {
      const result = await storeKey('test-key-1', 'my-secret-key');
      
      expect(result).toHaveProperty('id', 'test-key-1');
      expect(result).toHaveProperty('encryptedKey');
      expect(result).toHaveProperty('salt');
      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
      expect(result.encryptedKey).not.toBe('my-secret-key');
    });

    it('should store a key with metadata', async () => {
      const metadata = { purpose: 'wallet', chain: 'ETH' };
      const result = await storeKey('test-key-2', 'my-secret-key', metadata);
      
      expect(result.metadata).toEqual(metadata);
    });

    it('should throw error for empty key ID', async () => {
      await expect(storeKey('', 'my-secret-key')).rejects.toThrow('Key ID cannot be empty');
    });

    it('should throw error for empty key', async () => {
      await expect(storeKey('test-key', '')).rejects.toThrow('Key cannot be empty');
    });

    it('should throw error when master key is not set', async () => {
      vi.stubEnv('MASTER_ENCRYPTION_KEY', '');
      await expect(storeKey('test-key', 'my-secret-key')).rejects.toThrow(
        'MASTER_ENCRYPTION_KEY environment variable is not set'
      );
    });
  });

  describe('retrieveKey', () => {
    it('should retrieve a stored key', async () => {
      const originalKey = 'my-secret-key-12345';
      await storeKey('retrieve-test', originalKey);
      
      const retrieved = await retrieveKey('retrieve-test');
      expect(retrieved).toBe(originalKey);
    });

    it('should return null for non-existent key', async () => {
      const result = await retrieveKey('non-existent');
      expect(result).toBeNull();
    });

    it('should throw error for empty key ID', async () => {
      await expect(retrieveKey('')).rejects.toThrow('Key ID cannot be empty');
    });

    it('should retrieve complex key values', async () => {
      const complexKey = JSON.stringify({ privateKey: '0x123', mnemonic: 'word1 word2' });
      await storeKey('complex-key', complexKey);
      
      const retrieved = await retrieveKey('complex-key');
      expect(retrieved).toBe(complexKey);
    });
  });

  describe('keyExists', () => {
    it('should return true for existing key', async () => {
      await storeKey('exists-test', 'some-key');
      
      const exists = await keyExists('exists-test');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const exists = await keyExists('does-not-exist');
      expect(exists).toBe(false);
    });

    it('should throw error for empty key ID', async () => {
      await expect(keyExists('')).rejects.toThrow('Key ID cannot be empty');
    });
  });

  describe('deleteKey', () => {
    it('should delete an existing key', async () => {
      await storeKey('delete-test', 'some-key');
      
      const deleted = await deleteKey('delete-test');
      expect(deleted).toBe(true);
      
      const exists = await keyExists('delete-test');
      expect(exists).toBe(false);
    });

    it('should return false for non-existent key', async () => {
      const deleted = await deleteKey('non-existent');
      expect(deleted).toBe(false);
    });

    it('should throw error for empty key ID', async () => {
      await expect(deleteKey('')).rejects.toThrow('Key ID cannot be empty');
    });
  });

  describe('updateKey', () => {
    it('should update an existing key', async () => {
      await storeKey('update-test', 'original-key');
      
      const updated = await updateKey('update-test', 'new-key-value');
      expect(updated).not.toBeNull();
      expect(updated?.id).toBe('update-test');
      
      const retrieved = await retrieveKey('update-test');
      expect(retrieved).toBe('new-key-value');
    });

    it('should return null for non-existent key', async () => {
      const result = await updateKey('non-existent', 'new-value');
      expect(result).toBeNull();
    });

    it('should update the updatedAt timestamp', async () => {
      const original = await storeKey('timestamp-test', 'original-key');
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updated = await updateKey('timestamp-test', 'new-key');
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(original.createdAt.getTime());
    });

    it('should throw error for empty key ID', async () => {
      await expect(updateKey('', 'new-key')).rejects.toThrow('Key ID cannot be empty');
    });

    it('should throw error for empty new key', async () => {
      await storeKey('test', 'original');
      await expect(updateKey('test', '')).rejects.toThrow('New key cannot be empty');
    });
  });

  describe('getKeyMetadata', () => {
    it('should return metadata without encrypted key', async () => {
      const metadata = { purpose: 'test' };
      await storeKey('metadata-test', 'secret-key', metadata);
      
      const result = await getKeyMetadata('metadata-test');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('metadata-test');
      expect(result?.metadata).toEqual(metadata);
      expect(result).not.toHaveProperty('encryptedKey');
    });

    it('should return null for non-existent key', async () => {
      const result = await getKeyMetadata('non-existent');
      expect(result).toBeNull();
    });

    it('should throw error for empty key ID', async () => {
      await expect(getKeyMetadata('')).rejects.toThrow('Key ID cannot be empty');
    });
  });

  describe('listKeyIds', () => {
    it('should return empty array when no keys stored', async () => {
      const ids = await listKeyIds();
      expect(ids).toEqual([]);
    });

    it('should return all stored key IDs', async () => {
      await storeKey('key-1', 'value-1');
      await storeKey('key-2', 'value-2');
      await storeKey('key-3', 'value-3');
      
      const ids = await listKeyIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('key-1');
      expect(ids).toContain('key-2');
      expect(ids).toContain('key-3');
    });
  });

  describe('clearKeyStore', () => {
    it('should clear all stored keys', async () => {
      await storeKey('key-1', 'value-1');
      await storeKey('key-2', 'value-2');
      
      clearKeyStore();
      
      const ids = await listKeyIds();
      expect(ids).toHaveLength(0);
    });
  });

  describe('rotateKey', () => {
    it('should rotate a key with new encryption', async () => {
      const originalKey = 'my-secret-key';
      const original = await storeKey('rotate-test', originalKey);
      const originalSalt = original.salt;
      
      const rotated = await rotateKey('rotate-test');
      expect(rotated).not.toBeNull();
      expect(rotated?.salt).not.toBe(originalSalt);
      
      // Key value should still be the same after rotation
      const retrieved = await retrieveKey('rotate-test');
      expect(retrieved).toBe(originalKey);
    });

    it('should return null for non-existent key', async () => {
      const result = await rotateKey('non-existent');
      expect(result).toBeNull();
    });

    it('should throw error for empty key ID', async () => {
      await expect(rotateKey('')).rejects.toThrow('Key ID cannot be empty');
    });
  });

  describe('storeMultipleKeys', () => {
    it('should store multiple keys', async () => {
      const keys = [
        { id: 'multi-1', key: 'value-1' },
        { id: 'multi-2', key: 'value-2', metadata: { type: 'test' } },
        { id: 'multi-3', key: 'value-3' },
      ];
      
      const results = await storeMultipleKeys(keys);
      expect(results).toHaveLength(3);
      
      const retrieved1 = await retrieveKey('multi-1');
      const retrieved2 = await retrieveKey('multi-2');
      const retrieved3 = await retrieveKey('multi-3');
      
      expect(retrieved1).toBe('value-1');
      expect(retrieved2).toBe('value-2');
      expect(retrieved3).toBe('value-3');
    });

    it('should throw error for empty keys array', async () => {
      await expect(storeMultipleKeys([])).rejects.toThrow('Keys array cannot be empty');
    });
  });

  describe('deleteMultipleKeys', () => {
    it('should delete multiple keys', async () => {
      await storeKey('del-1', 'value-1');
      await storeKey('del-2', 'value-2');
      await storeKey('del-3', 'value-3');
      
      const deleted = await deleteMultipleKeys(['del-1', 'del-2']);
      expect(deleted).toBe(2);
      
      expect(await keyExists('del-1')).toBe(false);
      expect(await keyExists('del-2')).toBe(false);
      expect(await keyExists('del-3')).toBe(true);
    });

    it('should return count of actually deleted keys', async () => {
      await storeKey('exists', 'value');
      
      const deleted = await deleteMultipleKeys(['exists', 'non-existent']);
      expect(deleted).toBe(1);
    });

    it('should throw error for empty IDs array', async () => {
      await expect(deleteMultipleKeys([])).rejects.toThrow('IDs array cannot be empty');
    });
  });

  describe('Integration: Store and Retrieve Workflow', () => {
    it('should handle complete key lifecycle', async () => {
      // Store
      const stored = await storeKey('lifecycle-test', 'initial-key', { version: 1 });
      expect(stored.id).toBe('lifecycle-test');
      
      // Verify exists
      expect(await keyExists('lifecycle-test')).toBe(true);
      
      // Retrieve
      expect(await retrieveKey('lifecycle-test')).toBe('initial-key');
      
      // Update
      await updateKey('lifecycle-test', 'updated-key');
      expect(await retrieveKey('lifecycle-test')).toBe('updated-key');
      
      // Rotate
      await rotateKey('lifecycle-test');
      expect(await retrieveKey('lifecycle-test')).toBe('updated-key');
      
      // Delete
      expect(await deleteKey('lifecycle-test')).toBe(true);
      expect(await keyExists('lifecycle-test')).toBe(false);
    });
  });
});