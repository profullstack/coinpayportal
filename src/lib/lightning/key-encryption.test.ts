import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { decryptLnKey, encryptLnKey, lnKeyEncryptionConfigured, LnKeyEncryptionError } from './key-encryption';

const KEY = randomBytes(32).toString('hex');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('LNbits key encryption fails closed', () => {
  it('round-trips with a valid key', () => {
    vi.stubEnv('LN_KEY_ENCRYPTION_KEY', KEY);
    const stored = encryptLnKey('adminkey-123');
    expect(stored.startsWith('enc:')).toBe(true);
    expect(stored).not.toContain('adminkey-123');
    expect(decryptLnKey(stored)).toBe('adminkey-123');
  });

  it('refuses to store plaintext when the key is unset', () => {
    vi.stubEnv('LN_KEY_ENCRYPTION_KEY', '');
    expect(lnKeyEncryptionConfigured()).toBe(false);
    expect(() => encryptLnKey('adminkey-123')).toThrow(LnKeyEncryptionError);
  });

  it('refuses to store plaintext when the key is malformed', () => {
    vi.stubEnv('LN_KEY_ENCRYPTION_KEY', 'short');
    expect(lnKeyEncryptionConfigured()).toBe(false);
    expect(() => encryptLnKey('adminkey-123')).toThrow(LnKeyEncryptionError);
  });

  it('refuses to read a plaintext stored key', () => {
    vi.stubEnv('LN_KEY_ENCRYPTION_KEY', KEY);
    expect(() => decryptLnKey('plain-adminkey')).toThrow(LnKeyEncryptionError);
  });

  it('refuses to decrypt without the key', () => {
    vi.stubEnv('LN_KEY_ENCRYPTION_KEY', KEY);
    const stored = encryptLnKey('adminkey-123');
    vi.stubEnv('LN_KEY_ENCRYPTION_KEY', '');
    expect(() => decryptLnKey(stored)).toThrow(LnKeyEncryptionError);
  });
});
