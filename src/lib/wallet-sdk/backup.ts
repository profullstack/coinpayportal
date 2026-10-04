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
/**
 * Minimum strength for the passphrase protecting an exported seed phrase.
 *
 * L6B-05 / REC-01: this accepted any password, including an empty one, while
 * the wallet create and import flows require length >= 8 plus a strength score.
 * The exported file is the one artefact that leaves the device — the thing an
 * attacker walks away with — so it should not have the weakest gate.
 *
 * The rule is LENGTH-primary, deliberately. Requiring particular character
 * classes is a poor proxy for entropy and actively penalises the passwords
 * people should be encouraged to use: a long passphrase, or a non-Latin one,
 * can be far stronger than `Passw0rd!` while failing an upper/lower/digit
 * check. Counted in code points, so an emoji or a CJK character counts once
 * rather than twice.
 *
 * Enforced here rather than only in the UI: the UI check protects one button,
 * this protects every caller of the SDK.
 */
export function assertBackupPasswordStrength(password: string): void {
  const chars = [...(password ?? '')];

  if (chars.length < 12) {
    throw new Error(
      'Backup password too weak — it is the only thing protecting your seed phrase. ' +
      'It needs at least 12 characters.'
    );
  }

  // Long enough that variety stops mattering much.
  if (chars.length >= 16) return;

  const classes = [
    /\p{Ll}/u,
    /\p{Lu}/u,
    /\p{Nd}/u,
    /[^\p{L}\p{Nd}]/u,
  ].filter((re) => re.test(password)).length;

  if (classes < 2) {
    throw new Error(
      'Backup password too weak — it is the only thing protecting your seed phrase. ' +
      'Use 16+ characters, or mix character types.'
    );
  }
}

export async function encryptSeedPhrase(
  mnemonic: string,
  password: string,
  walletId: string
): Promise<EncryptedBackup> {
  assertBackupPasswordStrength(password);

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
