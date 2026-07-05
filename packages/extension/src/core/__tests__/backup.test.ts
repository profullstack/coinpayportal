import { describe, it, expect } from 'vitest';
import { pickIndices, makeChoices } from '../backup.js';

// Deterministic PRNG for reproducible tests.
function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('backup confirmation helpers', () => {
  it('pickIndices returns n distinct, in-range, sorted indices', () => {
    const idx = pickIndices(12, 3, seededRand(1));
    expect(idx).toHaveLength(3);
    expect(new Set(idx).size).toBe(3);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(idx.every((i) => i >= 0 && i < 12)).toBe(true);
  });

  it('pickIndices throws when n > total', () => {
    expect(() => pickIndices(3, 4)).toThrow(/exceed/);
  });

  it('makeChoices always includes the correct word + requested decoys', () => {
    const words = 'alpha bravo charlie delta echo foxtrot'.split(' ');
    const wordlist = ['zulu', 'yankee', 'xray', 'whiskey', 'victor', 'delta'];
    const choices = makeChoices(words, 3, wordlist, 2, seededRand(7));
    expect(choices).toHaveLength(3);
    expect(choices).toContain('delta'); // the correct word at index 3
    expect(new Set(choices).size).toBe(3); // no duplicates
  });
});
