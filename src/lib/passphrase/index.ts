/**
 * Memorable passphrase sign-in.
 *
 * The phrase never leaves the browser. It is stretched with scrypt (memory
 * hard, so a stolen database is expensive to guess against) into an Ed25519
 * seed; the server stores only the public key and the salt, and a login is a
 * signature over a one-time challenge. Same idea as a wallet seed phrase, but
 * the phrase is a sentence a person can picture and remember.
 *
 * Pure module: runs in the browser and in Node (WebCrypto is used for
 * randomness and for Ed25519's SHA-512).
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { Point, getPublicKeyAsync, signAsync, verifyAsync } from '@noble/ed25519';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { ADJECTIVES, ADVERBS, COLORS, NOUNS, PREPOSITIONS, VERBS } from './words';

export const PASSPHRASE_VERSION = 1;

/** scrypt N=2^17, r=8: 128 MiB and roughly a second in a browser. */
export const DEFAULT_KDF = { alg: 'scrypt', N: 131072, r: 8, p: 1, v: PASSPHRASE_VERSION } as const;
export type PassphraseKdf = { alg: 'scrypt'; N: number; r: number; p: number; v: number };

/** Exact entropy of a generated phrase, in bits. */
export const GENERATED_BITS =
  3 * Math.log2(ADJECTIVES.length) +
  Math.log2(COLORS.length) +
  3 * Math.log2(NOUNS.length) +
  Math.log2(VERBS.length) +
  Math.log2(PREPOSITIONS.length) +
  Math.log2(ADVERBS.length);

const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * The form of a phrase that gets hashed. Forgiving on purpose, because a
 * phrase that only works when typed exactly is one people lock themselves out
 * of: case, punctuation, accents-as-composed, extra spaces and the words
 * "a", "an" and "the" are all ignored.
 */
export function normalizePassphrase(phrase: string): string {
  return phrase
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !ARTICLES.has(w))
    .join(' ');
}

function randomIndex(size: number): number {
  // Every list is a power of two, so masking is exact (no modulo bias).
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] & (size - 1);
}

function pick<T>(list: readonly T[]): T {
  return list[randomIndex(list.length)];
}

function article(next: string): string {
  return /^[aeiou]/.test(next) ? 'an' : 'a';
}

/**
 * A crypto-random sentence, 12 words, 71 bits:
 * "fuzzy purple walrus juggles a rusty trumpet under the sleepy volcano loudly"
 */
export function generatePassphrase(): string {
  const objAdj = pick(ADJECTIVES);
  return [
    pick(ADJECTIVES), pick(COLORS), pick(NOUNS), pick(VERBS),
    article(objAdj), objAdj, pick(NOUNS),
    pick(PREPOSITIONS), 'the', pick(ADJECTIVES), pick(NOUNS),
    pick(ADVERBS),
  ].join(' ');
}

export type Strength = { ok: boolean; bits: number; words: number; reason?: string };

/**
 * Strength of a phrase the person made up themselves. We assume the attacker
 * guesses from a dictionary, so each distinct word is worth about 11 bits at
 * best, and we ask for at least 6 of them (66 bits, behind scrypt). Known text
 * (lyrics, quotes, verses) is far weaker than this estimate; the UI says so.
 */
export function checkStrength(phrase: string): Strength {
  const words = normalizePassphrase(phrase).split(' ').filter(Boolean);
  const distinct = new Set(words.filter((w) => w.length >= 2));
  const bits = Math.round(distinct.size * 11);
  if (words.length < 6) return { ok: false, bits, words: words.length, reason: 'Use at least 6 words.' };
  if (distinct.size < 6) return { ok: false, bits, words: words.length, reason: 'Use at least 6 different words.' };
  if (words.join('').length < 24) return { ok: false, bits, words: words.length, reason: 'Use longer words (24 letters or more in total).' };
  return { ok: true, bits, words: words.length };
}

export function randomSaltHex(): string {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

export function isValidKdf(kdf: unknown): kdf is PassphraseKdf {
  if (!kdf || typeof kdf !== 'object') return false;
  const k = kdf as Record<string, unknown>;
  return (
    k.alg === 'scrypt' &&
    typeof k.N === 'number' && Number.isInteger(k.N) && k.N >= 32768 && k.N <= 1048576 && (k.N & (k.N - 1)) === 0 &&
    k.r === 8 && k.p === 1 && k.v === PASSPHRASE_VERSION
  );
}

/** Ed25519 secret key (32 bytes) from the phrase. Slow on purpose. */
export async function deriveSecretKey(phrase: string, saltHex: string, kdf: PassphraseKdf = DEFAULT_KDF): Promise<Uint8Array> {
  const normalized = normalizePassphrase(phrase);
  if (!normalized) throw new Error('Passphrase is empty');
  return scryptAsync(utf8ToBytes(`coinpay-passphrase-v${kdf.v}:${normalized}`), hexToBytes(saltHex), {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    dkLen: 32,
    maxmem: 2 ** 28,
  });
}

export async function publicKeyHex(secretKey: Uint8Array): Promise<string> {
  return bytesToHex(await getPublicKeyAsync(secretKey));
}

/** The exact bytes a login signs: bound to the challenge and the account. */
export function loginMessage(challenge: string, email: string): Uint8Array {
  return utf8ToBytes(`coinpayportal passphrase login v1\n${challenge}\n${email.trim().toLowerCase()}`);
}

export async function signLogin(secretKey: Uint8Array, challenge: string, email: string): Promise<string> {
  return bytesToHex(await signAsync(loginMessage(challenge, email), secretKey));
}

/**
 * A public key we are willing to store. Small-order points (the identity among
 * them) make "valid" signatures for every message, so a stored one would be a
 * login anyone can forge.
 */
export function isAcceptablePublicKey(publicKey: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(publicKey)) return false;
  try {
    return !Point.fromHex(publicKey, false).isSmallOrder();
  } catch {
    return false;
  }
}

export async function verifyLogin(publicKey: string, signature: string, challenge: string, email: string): Promise<boolean> {
  if (!/^[0-9a-f]{128}$/.test(signature) || !isAcceptablePublicKey(publicKey)) return false;
  try {
    // Strict RFC 8032. The library default (ZIP-215) accepts the all-zero key
    // with an all-zero signature for any message.
    return await verifyAsync(hexToBytes(signature), loginMessage(challenge, email), hexToBytes(publicKey), { zip215: false });
  } catch {
    return false;
  }
}
