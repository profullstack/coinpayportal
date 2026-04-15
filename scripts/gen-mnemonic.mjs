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
 *   4. Maps each group to a word from the official BIP39 English wordlist
 *      (fetched from https://github.com/bitcoinjs/bip39).
 */

import { createHash, randomBytes } from 'crypto';
import { get } from 'https';

function fetchWordlist() {
  return new Promise((resolve, reject) => {
    get('https://raw.githubusercontent.com/bitcoinjs/bip39/master/src/wordlists/english.json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
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

const wordlist = await fetchWordlist();
console.log(generateMnemonic(wordlist));
