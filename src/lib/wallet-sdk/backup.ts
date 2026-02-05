/**
 * Wallet Seed Phrase Backup (GPG-compatible)
 *
 * Provides functions for encrypting seed phrases using OpenPGP symmetric
 * encryption (AES-256). Output is standard GPG-compatible — decrypt with:
 *
 *   gpg --decrypt wallet_coinpayportal_<id>_seedphrase.txt.gpg
 *
 * Works in both browser and Node.js environments.
 */

export interface EncryptedBackup {
  /** Raw encrypted bytes (GPG binary format) */
  data: Uint8Array;
  /** Suggested filename */
  filename: string;
  /** Wallet ID used */
  walletId: string;
}

/**
 * Encrypt a seed phrase with a password using OpenPGP symmetric encryption.
 *
 * @param mnemonic - The plaintext seed phrase
 * @param password - Passphrase for GPG encryption
 * @param walletId - Wallet ID (used in filename and file header)
 * @returns Encrypted backup with raw bytes and suggested filename
 */
export async function encryptSeedPhrase(
  mnemonic: string,
  password: string,
  walletId: string
): Promise<EncryptedBackup> {
  // Lazy-load openpgp to avoid crashing in jsdom/SSR environments
  const openpgp = await import('openpgp');

  const filename = `wallet_coinpayportal_${walletId}_seedphrase.txt`;

  const content = [
    '# CoinPayPortal Wallet Seed Phrase Backup',
    `# Wallet ID: ${walletId}`,
    `# Created: ${new Date().toISOString()}`,
    '#',
    '# KEEP THIS FILE SAFE. Anyone with this phrase can access your funds.',
    `# Decrypt with: gpg --decrypt ${filename}.gpg`,
    '',
    mnemonic,
    '',
  ].join('\n');

  const message = await openpgp.createMessage({ text: content });
  const encrypted = await openpgp.encrypt({
    message,
    passwords: [password],
    format: 'binary',
    config: {
      preferredSymmetricAlgorithm: openpgp.enums.symmetric.aes256,
      preferredCompressionAlgorithm: openpgp.enums.compression.zlib,
    },
  });

  const data = encrypted instanceof Uint8Array
    ? encrypted
    : new TextEncoder().encode(encrypted as string);

  return {
    data: new Uint8Array(data),
    filename: `${filename}.gpg`,
    walletId,
  };
}

/**
 * Decrypt a GPG-encrypted seed phrase backup.
 *
 * @param encrypted - The raw GPG encrypted bytes
 * @param password - The passphrase used during encryption
 * @returns The decrypted seed phrase, or null if password is wrong
 */
export async function decryptSeedPhrase(
  encrypted: Uint8Array,
  password: string
): Promise<string | null> {
  // Lazy-load openpgp to avoid crashing in jsdom/SSR environments
  const openpgp = await import('openpgp');

  try {
    const message = await openpgp.readMessage({
      binaryMessage: encrypted,
    });

    const { data } = await openpgp.decrypt({
      message,
      passwords: [password],
    });

    // Extract just the mnemonic (skip comment lines)
    const lines = (data as string).split('\n');
    const mnemonic = lines
      .filter((l) => !l.startsWith('#') && l.trim().length > 0)
      .join(' ')
      .trim();

    return mnemonic || null;
  } catch {
    return null;
  }
}
