/**
 * Seed Phrase GPG Backup
 *
 * Encrypts the seed phrase using OpenPGP symmetric encryption (AES-256)
 * and triggers a browser download. The resulting .gpg file can be
 * decrypted with: gpg --decrypt wallet_<id>_seedphrase.txt.gpg
 *
 * IMPORTANT: Everything runs client-side. The seed phrase never leaves
 * the browser. No server calls are made.
 */

/**
 * Encrypt a seed phrase with the user's password using OpenPGP symmetric encryption
 * and trigger a file download in the browser.
 *
 * @param mnemonic - The plaintext seed phrase
 * @param password - The user's wallet password (used as GPG passphrase)
 * @param walletId - The wallet ID (used in filename)
 */
export async function downloadEncryptedSeedPhrase(
  mnemonic: string,
  password: string,
  walletId: string
): Promise<void> {
  // Lazy-load openpgp to avoid crashing in jsdom/SSR environments
  const openpgp = await import('openpgp');

  const filename = `wallet_${walletId}_seedphrase.txt`;

  // Create the plaintext content
  const content = [
    '# CoinPayPortal Wallet Seed Phrase Backup',
    `# Wallet ID: ${walletId}`,
    `# Created: ${new Date().toISOString()}`,
    '#',
    '# KEEP THIS FILE SAFE. Anyone with this phrase can access your funds.',
    '# Decrypt with: gpg --decrypt ' + filename + '.gpg',
    '',
    mnemonic,
    '',
  ].join('\n');

  // Encrypt using OpenPGP symmetric (password-based) encryption
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

  // Convert to Blob and trigger download
  const data = encrypted instanceof Uint8Array
    ? encrypted
    : new TextEncoder().encode(encrypted as string);
  const blob = new Blob([new Uint8Array(data)], {
    type: 'application/pgp-encrypted',
  });

  triggerDownload(blob, filename + '.gpg');
}

/**
 * Trigger a browser file download from a Blob.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 100);
}
