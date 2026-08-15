/**
 * Fail-closed accessors for custody-grade secrets.
 *
 * Every path that encrypts or decrypts key material must go through here. The
 * previous code fell back to `'0'.repeat(64)` when `ENCRYPTION_KEY` was unset,
 * which meant a database leak alone was enough to recover every private key —
 * the "encryption" was performed under a publicly known constant. Refusing to
 * operate is always preferable to operating under a known key.
 */

/** A 32-byte key rendered as 64 lowercase hex characters. */
const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

/**
 * Keys that are structurally valid hex but carry no entropy. These show up in
 * copy-pasted `.env.example` files and in the old zero-key fallback, so they
 * are rejected explicitly rather than left to a generic entropy heuristic.
 */
const KNOWN_WEAK_KEYS = new Set([
  '0'.repeat(64),
  'f'.repeat(64),
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'deadbeef'.repeat(8),
]);

function isWeak(keyHex: string): boolean {
  const normalized = keyHex.toLowerCase();
  if (KNOWN_WEAK_KEYS.has(normalized)) return true;
  // A key made of a single repeated nibble (all zeros, all 'a', ...) has 4 bits
  // of entropy at best; treat the whole family as weak.
  return new Set(normalized).size <= 2;
}

/**
 * Return `ENCRYPTION_KEY`, or throw if it is missing, malformed, or a known
 * weak constant. Never returns a fallback.
 *
 * @throws {Error} when the key is unusable — callers must not catch and continue.
 */
export function requireEncryptionKey(purpose = 'custody'): string {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      `ENCRYPTION_KEY is not configured — refusing to perform ${purpose} operations. ` +
        'Set a 64-character hex key (openssl rand -hex 32) before starting the service.'
    );
  }

  if (!HEX_32_BYTES.test(key)) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex characters (32 bytes); got ${key.length} characters. ` +
        `Refusing to perform ${purpose} operations.`
    );
  }

  if (isWeak(key)) {
    throw new Error(
      `ENCRYPTION_KEY is a known-weak constant — refusing to perform ${purpose} operations. ` +
        'Generate a fresh key with `openssl rand -hex 32` and rotate any data encrypted under the old one.'
    );
  }

  return key;
}

/**
 * Return the master mnemonic used to derive deposit addresses, or throw.
 *
 * Generating a random mnemonic on the fly (the previous fallback) produces
 * addresses whose keys are lost the moment the process restarts — funds sent
 * to them are unrecoverable. That is a fail-open we cannot tolerate.
 *
 * @throws {Error} when `MASTER_MNEMONIC` is absent or obviously not a mnemonic.
 */
export function requireMasterMnemonic(): string {
  const mnemonic = process.env.MASTER_MNEMONIC;

  if (!mnemonic) {
    throw new Error(
      'MASTER_MNEMONIC is not configured — refusing to derive deposit addresses. ' +
        'Deriving from an ephemeral mnemonic would make received funds unrecoverable.'
    );
  }

  const words = mnemonic.trim().split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error(
      `MASTER_MNEMONIC must be a 12-24 word BIP-39 mnemonic; got ${words.length} words.`
    );
  }

  return mnemonic.trim();
}
