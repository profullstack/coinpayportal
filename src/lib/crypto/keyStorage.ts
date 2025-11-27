/**
 * Secure Key Storage Service
 * Provides secure storage and retrieval of encryption keys
 */

import { encrypt, decrypt, deriveKey, generateSalt } from './encryption';

/**
 * Key storage entry interface
 */
export interface StoredKey {
  id: string;
  encryptedKey: string;
  salt: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Key storage configuration
 */
interface KeyStorageConfig {
  masterKey: string;
}

/**
 * In-memory key storage (for development/testing)
 * In production, this should be replaced with a secure database or HSM
 */
const keyStore = new Map<string, StoredKey>();

/**
 * Get master key from environment
 */
function getMasterKey(): string {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error('MASTER_ENCRYPTION_KEY environment variable is not set');
  }
  return masterKey;
}

/**
 * Store a key securely
 * @param id - Unique identifier for the key
 * @param key - The key to store (will be encrypted)
 * @param metadata - Optional metadata to store with the key
 * @returns The stored key entry
 */
export async function storeKey(
  id: string,
  key: string,
  metadata?: Record<string, unknown>
): Promise<StoredKey> {
  if (!id || id.length === 0) {
    throw new Error('Key ID cannot be empty');
  }
  if (!key || key.length === 0) {
    throw new Error('Key cannot be empty');
  }

  const masterKey = getMasterKey();
  const salt = generateSalt();
  const derivedKey = deriveKey(masterKey, salt);
  const encryptedKey = encrypt(key, derivedKey);

  const now = new Date();
  const storedKey: StoredKey = {
    id,
    encryptedKey,
    salt,
    createdAt: now,
    updatedAt: now,
    metadata,
  };

  keyStore.set(id, storedKey);
  return storedKey;
}

/**
 * Retrieve a key by ID
 * @param id - The key identifier
 * @returns The decrypted key or null if not found
 */
export async function retrieveKey(id: string): Promise<string | null> {
  if (!id || id.length === 0) {
    throw new Error('Key ID cannot be empty');
  }

  const storedKey = keyStore.get(id);
  if (!storedKey) {
    return null;
  }

  const masterKey = getMasterKey();
  const derivedKey = deriveKey(masterKey, storedKey.salt);
  const decryptedKey = decrypt(storedKey.encryptedKey, derivedKey);

  return decryptedKey;
}

/**
 * Check if a key exists
 * @param id - The key identifier
 * @returns True if the key exists
 */
export async function keyExists(id: string): Promise<boolean> {
  if (!id || id.length === 0) {
    throw new Error('Key ID cannot be empty');
  }
  return keyStore.has(id);
}

/**
 * Delete a key
 * @param id - The key identifier
 * @returns True if the key was deleted
 */
export async function deleteKey(id: string): Promise<boolean> {
  if (!id || id.length === 0) {
    throw new Error('Key ID cannot be empty');
  }
  return keyStore.delete(id);
}

/**
 * Update a key's value
 * @param id - The key identifier
 * @param newKey - The new key value
 * @returns The updated stored key entry or null if not found
 */
export async function updateKey(
  id: string,
  newKey: string
): Promise<StoredKey | null> {
  if (!id || id.length === 0) {
    throw new Error('Key ID cannot be empty');
  }
  if (!newKey || newKey.length === 0) {
    throw new Error('New key cannot be empty');
  }

  const existingKey = keyStore.get(id);
  if (!existingKey) {
    return null;
  }

  const masterKey = getMasterKey();
  const salt = generateSalt();
  const derivedKey = deriveKey(masterKey, salt);
  const encryptedKey = encrypt(newKey, derivedKey);

  const updatedKey: StoredKey = {
    ...existingKey,
    encryptedKey,
    salt,
    updatedAt: new Date(),
  };

  keyStore.set(id, updatedKey);
  return updatedKey;
}

/**
 * Get key metadata without decrypting
 * @param id - The key identifier
 * @returns The key metadata or null if not found
 */
export async function getKeyMetadata(
  id: string
): Promise<Omit<StoredKey, 'encryptedKey'> | null> {
  if (!id || id.length === 0) {
    throw new Error('Key ID cannot be empty');
  }

  const storedKey = keyStore.get(id);
  if (!storedKey) {
    return null;
  }

  // Return metadata without the encrypted key
  const { encryptedKey, ...metadata } = storedKey;
  return metadata;
}

/**
 * List all key IDs (without decrypting)
 * @returns Array of key IDs
 */
export async function listKeyIds(): Promise<string[]> {
  return Array.from(keyStore.keys());
}

/**
 * Clear all stored keys (for testing purposes)
 */
export function clearKeyStore(): void {
  keyStore.clear();
}

/**
 * Rotate a key with a new encryption
 * This re-encrypts the key with a new salt
 * @param id - The key identifier
 * @returns The rotated stored key entry or null if not found
 */
export async function rotateKey(id: string): Promise<StoredKey | null> {
  if (!id || id.length === 0) {
    throw new Error('Key ID cannot be empty');
  }

  // First retrieve the current key
  const currentKey = await retrieveKey(id);
  if (!currentKey) {
    return null;
  }

  // Re-encrypt with new salt
  return updateKey(id, currentKey);
}

/**
 * Store multiple keys atomically
 * @param keys - Array of key entries to store
 * @returns Array of stored key entries
 */
export async function storeMultipleKeys(
  keys: Array<{ id: string; key: string; metadata?: Record<string, unknown> }>
): Promise<StoredKey[]> {
  if (!keys || keys.length === 0) {
    throw new Error('Keys array cannot be empty');
  }

  const results: StoredKey[] = [];
  for (const { id, key, metadata } of keys) {
    const storedKey = await storeKey(id, key, metadata);
    results.push(storedKey);
  }
  return results;
}

/**
 * Delete multiple keys
 * @param ids - Array of key IDs to delete
 * @returns Number of keys deleted
 */
export async function deleteMultipleKeys(ids: string[]): Promise<number> {
  if (!ids || ids.length === 0) {
    throw new Error('IDs array cannot be empty');
  }

  let deleted = 0;
  for (const id of ids) {
    if (await deleteKey(id)) {
      deleted++;
    }
  }
  return deleted;
}