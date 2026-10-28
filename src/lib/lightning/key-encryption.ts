import { encrypt, decrypt } from '@/lib/crypto/encryption';

/**
 * LNbits wallet keys (wallets.ln_wallet_adminkey / ln_wallet_inkey) at rest.
 *
 * Fails closed (2026-10-28). The old version stored the admin key in
 * PLAINTEXT whenever LN_KEY_ENCRYPTION_KEY was unset or malformed, and read
 * any value without the `enc:` prefix back as plaintext. Now:
 *  - writing a key without a valid LN_KEY_ENCRYPTION_KEY throws, and callers
 *    check `lnKeyEncryptionConfigured()` BEFORE creating the LNbits wallet so
 *    a wallet is never minted and then lost;
 *  - reading a stored value that is not `enc:` is refused (prod had 0 such
 *    rows when this shipped).
 */

const ENCRYPTED_PREFIX = 'enc:';

export class LnKeyEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LnKeyEncryptionError';
  }
}

function getEncryptionKey(): string | null {
  const key = process.env.LN_KEY_ENCRYPTION_KEY?.trim();
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) return null;
  return key;
}

/** True when LNbits keys can be stored. Check before creating an LNbits wallet. */
export function lnKeyEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}

/** Encrypt an LNbits API key for storage. Throws when encryption is not configured. */
export function encryptLnKey(plainKey: string): string {
  if (!plainKey) return plainKey;
  if (plainKey.startsWith(ENCRYPTED_PREFIX)) return plainKey; // already encrypted
  const encKey = getEncryptionKey();
  if (!encKey) {
    throw new LnKeyEncryptionError(
      'LN_KEY_ENCRYPTION_KEY (64 hex chars) is required to store Lightning wallet keys; refusing to store them in plaintext',
    );
  }
  return ENCRYPTED_PREFIX + encrypt(plainKey, encKey);
}

/** Decrypt an LNbits API key read from the database. Plaintext values are refused. */
export function decryptLnKey(storedKey: string): string {
  if (!storedKey) return storedKey;
  if (!storedKey.startsWith(ENCRYPTED_PREFIX)) {
    throw new LnKeyEncryptionError('Stored Lightning wallet key is not encrypted; refusing to use it');
  }
  const encKey = getEncryptionKey();
  if (!encKey) {
    throw new LnKeyEncryptionError('LN_KEY_ENCRYPTION_KEY required to decrypt encrypted LN keys');
  }
  return decrypt(storedKey.slice(ENCRYPTED_PREFIX.length), encKey);
}
