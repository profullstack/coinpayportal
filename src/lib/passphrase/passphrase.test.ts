import { describe, it, expect } from 'vitest';
import * as W from './words';
import {
  GENERATED_BITS,
  checkStrength,
  deriveSecretKey,
  generatePassphrase,
  isAcceptablePublicKey,
  isValidKdf,
  normalizePassphrase,
  publicKeyHex,
  randomSaltHex,
  signLogin,
  verifyLogin,
} from './index';

// Fast params for tests only; isValidKdf's floor is 2^15.
const KDF = { alg: 'scrypt', N: 32768, r: 8, p: 1, v: 1 } as const;

describe('word lists', () => {
  const lists = { ADJECTIVES: 256, COLORS: 16, NOUNS: 256, VERBS: 256, PREPOSITIONS: 32, ADVERBS: 64 } as const;
  it.each(Object.entries(lists))('%s has exactly %i lowercase, unique words', (name, size) => {
    const list = (W as Record<string, readonly string[]>)[name];
    expect(list).toHaveLength(size);
    expect(new Set(list).size).toBe(size);
    for (const w of list) expect(w).toMatch(/^[a-z]+$/);
  });
  it('no word is in two lists, and none is an article', () => {
    const all = Object.keys(lists).flatMap((k) => [...(W as Record<string, readonly string[]>)[k]]);
    expect(new Set(all).size).toBe(all.length);
    for (const a of ['a', 'an', 'the']) expect(all).not.toContain(a);
  });
});

describe('generatePassphrase', () => {
  it('is a 12-word sentence worth 71 bits', () => {
    expect(GENERATED_BITS).toBe(71);
    for (let i = 0; i < 50; i++) {
      const p = generatePassphrase();
      const words = p.split(' ');
      expect(words).toHaveLength(12);
      expect(['a', 'an']).toContain(words[4]);
      expect(words[4]).toBe(/^[aeiou]/.test(words[5]) ? 'an' : 'a');
      expect(words[8]).toBe('the');
      expect(W.VERBS).toContain(words[3]);
    }
  });
  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, generatePassphrase));
    expect(seen.size).toBe(200);
  });
});

describe('normalizePassphrase', () => {
  it('forgives case, punctuation, spacing and articles', () => {
    const want = normalizePassphrase('fuzzy purple walrus juggles a rusty trumpet under the sleepy volcano loudly');
    expect(normalizePassphrase('  Fuzzy, PURPLE walrus juggles rusty trumpet\nunder sleepy volcano... loudly! ')).toBe(want);
    expect(normalizePassphrase('Fuzzy purple walrus juggles AN rusty trumpet under A sleepy volcano loudly')).toBe(want);
    expect(want).toBe('fuzzy purple walrus juggles rusty trumpet under sleepy volcano loudly');
  });
  it('keeps non-English letters', () => {
    expect(normalizePassphrase('Ñandú café — über')).toBe('ñandú café über');
  });
});

describe('checkStrength', () => {
  it('refuses short or repetitive phrases', () => {
    expect(checkStrength('yankee doodle dandy').ok).toBe(false);
    expect(checkStrength('dog dog dog dog dog dog dog').ok).toBe(false);
    expect(checkStrength('a b c d e f g').ok).toBe(false);
  });
  it('accepts six real, different words', () => {
    expect(checkStrength('my grumpy neighbour hides seventeen garden gnomes').ok).toBe(true);
  });
});

describe('isValidKdf', () => {
  it('accepts scrypt within bounds only', () => {
    expect(isValidKdf(KDF)).toBe(true);
    expect(isValidKdf({ ...KDF, N: 1024 })).toBe(false);
    expect(isValidKdf({ ...KDF, N: 40000 })).toBe(false);
    expect(isValidKdf({ ...KDF, alg: 'pbkdf2' })).toBe(false);
    expect(isValidKdf(null)).toBe(false);
  });
});

describe('key derivation + login signature', () => {
  it('round-trips and is bound to phrase, salt, challenge and email', async () => {
    const salt = randomSaltHex();
    const phrase = 'Fuzzy purple walrus juggles a rusty trumpet under the sleepy volcano loudly';
    const sk = await deriveSecretKey(phrase, salt, KDF);
    const pk = await publicKeyHex(sk);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);

    // Same phrase typed sloppily gives the same key.
    const sk2 = await deriveSecretKey('fuzzy purple walrus juggles rusty trumpet under sleepy volcano loudly', salt, KDF);
    expect(await publicKeyHex(sk2)).toBe(pk);

    const sig = await signLogin(sk, 'chal-1', 'Me@Example.com');
    expect(await verifyLogin(pk, sig, 'chal-1', 'me@example.com')).toBe(true);
    expect(await verifyLogin(pk, sig, 'chal-2', 'me@example.com')).toBe(false);
    expect(await verifyLogin(pk, sig, 'chal-1', 'other@example.com')).toBe(false);

    const other = await deriveSecretKey(phrase, randomSaltHex(), KDF);
    expect(await publicKeyHex(other)).not.toBe(pk);
    const wrong = await deriveSecretKey('fuzzy purple walrus juggles rusty trumpet under sleepy volcano quietly', salt, KDF);
    expect(await publicKeyHex(wrong)).not.toBe(pk);
  }, 30000);

  it('rejects malformed keys and signatures without throwing', async () => {
    expect(await verifyLogin('zz', 'aa', 'c', 'e')).toBe(false);
    expect(await verifyLogin('0'.repeat(64), '0'.repeat(128), 'c', 'e')).toBe(false);
  });

  it('never accepts a small-order public key (forgeable for every message)', async () => {
    const identity = '01' + '0'.repeat(62);
    expect(isAcceptablePublicKey('0'.repeat(64))).toBe(false);
    expect(isAcceptablePublicKey(identity)).toBe(false);
    expect(await verifyLogin(identity, '01' + '0'.repeat(126), 'c', 'e')).toBe(false);
    const sk = await deriveSecretKey('any old phrase will do here', randomSaltHex(), KDF);
    expect(isAcceptablePublicKey(await publicKeyHex(sk))).toBe(true);
  }, 30000);
});
