/**
 * Proof-of-ownership signatures must verify the way the CoinPay server checks
 * them: noble-curves v2 `secp256k1.verify(sig, messageBytes, pub)`, which
 * sha256-hashes the message (prehash defaults to true). With this SDK's
 * noble-curves v1 that is `verify(sig, sha256(messageBytes), pub)`.
 *
 * A raw-bytes signature verified false there, so `coinpay wallet create`,
 * `wallet import` and wallet sign-in all failed with 400 INVALID_SIGNATURE.
 */
import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { signProofMessage } from '../src/wallet.js';

const key = hexToBytes('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318');
const pub = secp256k1.getPublicKey(key, true);
const message = 'CoinPay Wallet Create: 1761690000000';
const bytes = new TextEncoder().encode(message);

describe('signProofMessage', () => {
  it('returns a 64-byte compact signature', () => {
    expect(signProofMessage(message, key)).toMatch(/^[0-9a-f]{128}$/);
  });

  it('verifies as a signature over sha256(message), which is what the server checks', () => {
    const sig = hexToBytes(signProofMessage(message, key));
    expect(secp256k1.verify(sig, sha256(bytes), pub)).toBe(true);
  });

  it('is not a signature over the raw message bytes (the INVALID_SIGNATURE bug)', () => {
    const sig = hexToBytes(signProofMessage(message, key));
    expect(secp256k1.verify(sig, bytes, pub)).toBe(false);
  });
});
