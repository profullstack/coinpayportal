import { describe, expect, it } from 'vitest';
import { hashStringToNumber } from './wallets';

/**
 * Regression tests for F-1.3-14 (2026-08-19 audit).
 *
 * The collection derivation index was a 32-bit string fold reduced modulo 10^6,
 * and the addresses it derives hold customer money. A million slots means two
 * different payments share an index — and therefore an address and a private
 * key — with about even odds by the 1,180th one. When that happens one
 * payment's funds land at another's address: the balance check confirms the
 * wrong payment and the sweep sends the money to the wrong destination.
 *
 * No attacker is involved. It is the birthday bound.
 */
describe('hashStringToNumber', () => {
  it('stays inside the non-hardened BIP32 range', () => {
    for (const s of ['collection_abc', '', 'x'.repeat(500), 'collection_0']) {
      const n = hashStringToNumber(s);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(0x7fffffff);
    }
  });

  it('is deterministic', () => {
    expect(hashStringToNumber('collection_abc')).toBe(hashStringToNumber('collection_abc'));
  });

  it('uses far more than the old million slots', () => {
    // The old implementation could not return anything at or above 1e6, so a
    // value above it is direct evidence the range actually widened rather than
    // the hash merely changing.
    const ids = Array.from({ length: 2_000 }, (_, i) => `collection_${i}`);
    const above = ids.map(hashStringToNumber).filter((n) => n >= 1_000_000);
    expect(above.length).toBeGreaterThan(1_900);
  });

  it('has no collisions across 20,000 payment ids', () => {
    // At the old 10^6 range this set would collide with overwhelming
    // probability — the even-odds point was around 1,180.
    const ids = Array.from({ length: 20_000 }, (_, i) => `collection_${i}`);
    const indexes = new Set(ids.map(hashStringToNumber));
    expect(indexes.size).toBe(ids.length);
  });

  it('would have collided at the old range on the same input set', () => {
    // Demonstrates the finding rather than the fix: reducing the same hash to
    // 10^6 reintroduces collisions immediately, which is why the call site also
    // checks the derived address for uniqueness instead of trusting the range.
    const ids = Array.from({ length: 20_000 }, (_, i) => `collection_${i}`);
    const narrowed = new Set(ids.map((s) => hashStringToNumber(s) % 1_000_000));
    expect(narrowed.size).toBeLessThan(ids.length);
  });
});
