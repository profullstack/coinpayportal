import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * AES-256-GCM encryption configuration
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;

/**
 * Bcrypt configuration
 */
const BCRYPT_ROUNDS = 12;

/**
 * PBKDF2 configuration for key derivation
 */
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha256';

/**
 * Generate a random encryption key (32 bytes as hex string)
 * @returns {string} 64-character hex string (32 bytes)
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {string} keyHex - 32-byte encryption key as hex string
 * @returns {string} Encrypted data as base64 string (format: iv:authTag:ciphertext)
 */
export function encrypt(plaintext: string, keyHex: string): string {
  try {
    // Validate key length
    if (keyHex.length !== KEY_LENGTH * 2) {
      throw new Error(`Invalid key length. Expected ${KEY_LENGTH * 2} hex characters, got ${keyHex.length}`);
    }

    // Convert hex key to buffer
    const key = Buffer.from(keyHex, 'hex');

    // Generate random IV
    const iv = randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = createCipheriv(ALGORITHM, key, iv);

    // Encrypt data
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Combine iv, authTag, and encrypted data
    // Format: iv:authTag:ciphertext (all base64 encoded)
    const result = [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');

    return result;
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encryptedData - Encrypted data (format: iv:authTag:ciphertext)
 * @param {string} keyHex - 32-byte encryption key as hex string
 * @returns {string} Decrypted plaintext
 */
export function decrypt(encryptedData: string, keyHex: string): string {
  try {
    // Validate key length
    if (keyHex.length !== KEY_LENGTH * 2) {
      throw new Error(`Invalid key length. Expected ${KEY_LENGTH * 2} hex characters, got ${keyHex.length}`);
    }

    // Convert hex key to buffer
    const key = Buffer.from(keyHex, 'hex');

    // Split encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivBase64, authTagBase64, encryptedBase64] = parts;

    // Convert from base64
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const encrypted = Buffer.from(encryptedBase64, 'base64');

    // Validate lengths
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length. Expected ${IV_LENGTH}, got ${iv.length}`);
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length. Expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
    }

    // Create decipher
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Derive a key from a master key and salt using PBKDF2
 * @param {string} masterKey - Master key or password
 * @param {string} salt - Unique salt for key derivation
 * @returns {string} Derived key as hex string (32 bytes)
 */
export function deriveKey(masterKey: string, salt: string): string {
  try {
    // Validate inputs
    if (!masterKey || masterKey.length === 0) {
      throw new Error('Master key cannot be empty');
    }
    if (!salt || salt.length === 0) {
      throw new Error('Salt cannot be empty');
    }

    // Derive key using PBKDF2
    const derivedKey = pbkdf2Sync(
      masterKey,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_LENGTH,
      PBKDF2_DIGEST
    );

    return derivedKey.toString('hex');
  } catch (error) {
    throw new Error(`Key derivation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Hash a password using bcrypt
 * @param {string} password - Password to hash
 * @returns {Promise<string>} Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    // Validate password
    if (!password || password.length === 0) {
      throw new Error('Password cannot be empty');
    }

    // Hash password with bcrypt
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return hash;
  } catch (error) {
    throw new Error(`Password hashing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Verify a password against a bcrypt hash
 * @param {string} password - Password to verify
 * @param {string} hash - Bcrypt hash to compare against
 * @returns {Promise<boolean>} True if password matches, false otherwise
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    // Validate inputs
    if (!password) {
      throw new Error('Password cannot be empty');
    }
    if (!hash) {
      throw new Error('Hash cannot be empty');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, hash);
    return isValid;
  } catch (error) {
    throw new Error(`Password verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a random salt for key derivation
 * @returns {string} Random salt as hex string
 */
export function generateSalt(): string {
  return randomBytes(SALT_LENGTH).toString('hex');
}

/**
 * Encrypt an object by converting it to JSON first
 * @param {any} data - Object to encrypt
 * @param {string} keyHex - Encryption key as hex string
 * @returns {string} Encrypted data
 */
export function encryptObject(data: any, keyHex: string): string {
  const json = JSON.stringify(data);
  return encrypt(json, keyHex);
}

/**
 * Decrypt data and parse as JSON object
 * @param {string} encryptedData - Encrypted data
 * @param {string} keyHex - Encryption key as hex string
 * @returns {any} Decrypted and parsed object
 */
export function decryptObject(encryptedData: string, keyHex: string): any {
  const json = decrypt(encryptedData, keyHex);
  return JSON.parse(json);
}