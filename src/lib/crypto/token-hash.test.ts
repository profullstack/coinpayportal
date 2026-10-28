import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { hashToken, isHashedToken, storedTokenMatches } from './token-hash';

describe('token hashing', () => {
  it('stores sha256 in a fixed, recognisable form', () => {
    const h = hashToken('otrk_abc');
    expect(h).toBe('sha256:' + createHash('sha256').update('otrk_abc').digest('hex'));
    expect(isHashedToken(h)).toBe(true);
    expect(isHashedToken('otrk_abc')).toBe(false);
  });

  it('matches a presented token against its stored hash', () => {
    expect(storedTokenMatches(hashToken('otrk_abc'), 'otrk_abc')).toBe(true);
    expect(storedTokenMatches(hashToken('otrk_abc'), 'otrk_abd')).toBe(false);
  });

  it('still matches a legacy raw row until it is migrated', () => {
    expect(storedTokenMatches('otrk_abc', 'otrk_abc')).toBe(true);
    expect(storedTokenMatches('otrk_abc', 'otrk_x')).toBe(false);
  });

  it('never accepts a leaked hash as the token', () => {
    const h = hashToken('otrk_abc');
    expect(storedTokenMatches(h, h)).toBe(false);
    expect(storedTokenMatches(h, '')).toBe(false);
    expect(storedTokenMatches(null, 'otrk_abc')).toBe(false);
  });
});
