/**
 * gen-mnemonic.mjs
 *
 * Generates a cryptographically secure BIP39 mnemonic phrase (12 words / 128-bit entropy).
 * Uses ONLY Node.js built-in modules — no npm install required.
 *
 * Usage:
 *   node scripts/gen-mnemonic.mjs
 *
 *   Output example:
 *     subway cinnamon outdoor must lamp parent oblige brown engage salad volcano loud
 *
 *   Paste the output into your .env wrapped in double quotes (required — values contain spaces):
 *     SYSTEM_MNEMONIC_ETH="subway cinnamon outdoor must lamp parent oblige brown engage salad volcano loud"
 *
 * When to use:
 *   Run this script once for each SYSTEM_MNEMONIC_* variable in your .env file:
 *     SYSTEM_MNEMONIC_BTC, SYSTEM_MNEMONIC_ETH, SYSTEM_MNEMONIC_POL,
 *     SYSTEM_MNEMONIC_SOL, MASTER_MNEMONIC, and any optional chain mnemonics.
 *
 *   Each chain should have its OWN unique phrase — never reuse the same mnemonic
 *   across multiple SYSTEM_MNEMONIC_* variables.
 *
 * Security:
 *   - Never generate mnemonics using an online tool for production wallets.
 *   - Store the output in a secrets manager (Doppler, Vault, AWS Secrets Manager).
 *   - Never commit actual mnemonic values to version control.
 *   - Treat these phrases like private keys — if compromised, funds are at risk.
 *
 * How it works:
 *   1. Generates 128 bits of cryptographically random entropy via Node.js crypto.
 *   2. Computes a SHA-256 checksum and appends the first 4 bits.
 *   3. Splits the result into 11-bit groups (12 groups total).
 *   4. Maps each group to a word from the official BIP39 English wordlist,
 *      taken from the LOCAL @scure/bip39 package — the same wordlist the
 *      wallet derivation code uses.
 */

import { createHash, randomBytes } from 'crypto';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * The wordlist is taken from the locally installed, lockfile-pinned
 * @scure/bip39 rather than fetched at runtime.
 *
 * It used to be downloaded from raw.githubusercontent.com/bitcoinjs/bip39 at
 * master on every run. Two problems with that, and the second is the serious
 * one:
 *
 *   1. Nothing verified what came back. A tampered or truncated response would
 *      silently change which words a given entropy maps to, and this script
 *      generates production wallet mnemonics.
 *
 *   2. It was a DIFFERENT source from the one used to DERIVE addresses.
 *      src/lib/blockchain/wallets.ts derives from @scure/bip39's list. If the
 *      two ever diverged — a reordering, an encoding difference, a moved file
 *      returning HTML — this script would emit a phrase that derives to
 *      different keys than the platform expects, and the funds sent to those
 *      addresses would be unrecoverable. Using one pinned source removes that
 *      class of failure entirely.
 *
 * The checksum below asserts the list is the canonical BIP-39 English one, so a
 * bad dependency resolution fails loudly instead of producing quiet garbage.
 */
const BIP39_ENGLISH_SHA256 =
  '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';

function assertCanonicalWordlist(words) {
  if (!Array.isArray(words) || words.length !== 2048) {
    throw new Error(`BIP-39 wordlist must have 2048 entries, got ${words?.length}`);
  }

  const digest = createHash('sha256').update(words.join('\n') + '\n').digest('hex');
  if (digest !== BIP39_ENGLISH_SHA256) {
    throw new Error(
      'BIP-39 English wordlist does not match the canonical checksum — refusing to ' +
        `generate a mnemonic. Expected ${BIP39_ENGLISH_SHA256}, got ${digest}.`
    );
  }
}

function generateMnemonic(wordlist, strength = 128) {
  const entropy = randomBytes(strength / 8);
  const hash = createHash('sha256').update(entropy).digest();
  const checksumBits = strength / 32;

  // Convert entropy bytes to bits
  const entropyBits = [...entropy].map(b => b.toString(2).padStart(8, '0')).join('');
  const checksumBitsStr = [...hash].map(b => b.toString(2).padStart(8, '0')).join('').slice(0, checksumBits);
  const bits = entropyBits + checksumBitsStr;

  // Split into 11-bit groups
  const chunks = bits.match(/.{11}/g);
  const words = chunks.map(chunk => wordlist[parseInt(chunk, 2)]);
  return words.join(' ');
}

assertCanonicalWordlist(wordlist);
console.log(generateMnemonic(wordlist));
