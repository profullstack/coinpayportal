import { describe, expect, it, afterEach, vi } from 'vitest';
import { requireEncryptionKey, tryRequireEncryptionKey } from './require-key';

/**
 * Regression tests for F9-01 (High, 2026-08-19 audit).
 *
 * `requireEncryptionKey` was correct and protected 4 of 13 real encryption call
 * sites. The other 9 — including the custody hot path (`hd-wallet`,
 * `system-wallet`, `secure-forwarding`, `escrow/service`) — each hand-rolled
 *
 *     const k = process.env.ENCRYPTION_KEY;
 *     if (!k) return { success: false, error: 'Encryption key not configured' };
 *
 * which establishes that a key is *present* and nothing about whether it is
 * usable. An all-zero key passed all nine.
 *
 * Two things kept the guard from spreading, and both are fixed:
 *   - it throws, and those call sites return result objects, so
 *     `tryRequireEncryptionKey` gives them a form that fits;
 *   - the repository's own test fixtures used values the guard rejects — one
 *     was literally a `KNOWN_WEAK_KEYS` entry — so adopting it would have
 *     turned the suite red.
 */

const STRONG = '9f2c41a7be05d38c6714e0ab5d92f3487c1de6b0a4358fce27d91b6408ea75c3';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireEncryptionKey', () => {
  it('returns a strong key unchanged', () => {
    vi.stubEnv('ENCRYPTION_KEY', STRONG);
    expect(requireEncryptionKey()).toBe(STRONG);
  });

  it('refuses a missing key rather than falling back', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => requireEncryptionKey()).toThrow(/not configured/i);
  });

  it.each([
    ['all zeros', '0'.repeat(64)],
    ['all f', 'f'.repeat(64)],
    ['sequential hex', '0123456789abcdef'.repeat(4)],
    ['repeated deadbeef', 'deadbeef'.repeat(8)],
  ])('refuses a known-weak key: %s', (_label, key) => {
    // The sequential-hex case is the one the repository used as a test fixture.
    vi.stubEnv('ENCRYPTION_KEY', key);
    expect(() => requireEncryptionKey()).toThrow(/weak/i);
  });

  it('refuses a key that is the wrong length', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'test-encryption-key-0123456789abcdef');
    expect(() => requireEncryptionKey()).toThrow(/64 hex characters/i);
  });

  it('refuses a 64-character string that is not hex', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'z'.repeat(64));
    expect(() => requireEncryptionKey()).toThrow(/64 hex characters/i);
  });

  it('names the purpose in the message, so the failing operation is identifiable', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => requireEncryptionKey('escrow')).toThrow(/escrow/);
  });
});

describe('tryRequireEncryptionKey', () => {
  it('returns the key on success', () => {
    vi.stubEnv('ENCRYPTION_KEY', STRONG);
    const result = tryRequireEncryptionKey();
    expect(result).toEqual({ ok: true, key: STRONG });
  });

  it('reports a weak key as a failure instead of throwing', () => {
    // The whole reason this variant exists: the custody call sites return
    // result objects, so a throwing-only guard did not fit them and they kept
    // reading the raw environment variable.
    vi.stubEnv('ENCRYPTION_KEY', '0'.repeat(64));
    const result = tryRequireEncryptionKey('escrow');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/weak/i);
      expect(result.error).toMatch(/escrow/);
    }
  });
});
