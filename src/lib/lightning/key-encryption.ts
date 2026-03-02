import { encrypt, decrypt } from '@/lib/crypto/encryption';

/**
 * Encryption key for LNbits wallet keys at rest.
 * Must be a 64-char hex string (32 bytes).
 * Returns null if not configured (encryption disabled).
 */
function getEncryptionKey(): string | null {
  const key = process.env.LN_KEY_ENCRYPTION_KEY;
  if (!key) return null;
  if (key.length !== 64) {
    console.warn('[LN Key Encryption] LN_KEY_ENCRYPTION_KEY must be 64 hex chars — encryption disabled');
    return null;
  }
  return key;
}

/** Prefix to identify already-encrypted values */
const ENCRYPTED_PREFIX = 'enc:';

/**
 * Encrypt an LNbits API key for storage in the database.
 * Returns the encrypted string prefixed with "enc:".
 * If encryption key is not configured, returns plaintext (backward compat).
 */
export function encryptLnKey(plainKey: string): string {
  if (!plainKey) return plainKey;
  if (plainKey.startsWith(ENCRYPTED_PREFIX)) return plainKey; // already encrypted
  const encKey = getEncryptionKey();
  if (!encKey) return plainKey; // encryption not configured
  return ENCRYPTED_PREFIX + encrypt(plainKey, encKey);
}

/**
 * Decrypt an LNbits API key read from the database.
 * If the value lacks the "enc:" prefix, it's treated as plaintext (backward compat).
 */
export function decryptLnKey(storedKey: string): string {
  if (!storedKey) return storedKey;
  if (!storedKey.startsWith(ENCRYPTED_PREFIX)) return storedKey; // plaintext (legacy)
  const encKey = getEncryptionKey();
  if (!encKey) {
    throw new Error('LN_KEY_ENCRYPTION_KEY required to decrypt encrypted LN keys');
  }
  return decrypt(storedKey.slice(ENCRYPTED_PREFIX.length), encKey);
}
