import { describe, it, expect } from 'vitest';
import { encryptSeed, decryptSeed } from '../vault.js';

const seed = new Uint8Array(64).map((_, i) => (i * 7 + 3) & 0xff);

describe('vault (AES-GCM + PBKDF2)', () => {
  it('round-trips a seed with the correct password', async () => {
    const vault = await encryptSeed(seed, 'correct horse battery staple');
    const out = await decryptSeed(vault, 'correct horse battery staple');
    expect([...out]).toEqual([...seed]);
  });

  it('rejects an empty password on encrypt', async () => {
    await expect(encryptSeed(seed, '')).rejects.toThrow(/password/i);
  });

  it('throws on the wrong password (GCM auth failure)', async () => {
    const vault = await encryptSeed(seed, 'right-password');
    await expect(decryptSeed(vault, 'wrong-password')).rejects.toThrow(/incorrect password/i);
  });

  it('produces a fresh salt + iv each time (non-deterministic ciphertext)', async () => {
    const a = await encryptSeed(seed, 'pw');
    const b = await encryptSeed(seed, 'pw');
    expect(a.salt).not.toEqual(b.salt);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });

  it('never stores the plaintext seed in the serialized vault', async () => {
    const vault = await encryptSeed(seed, 'pw');
    const serialized = JSON.stringify(vault);
    // The raw seed bytes must not appear as a hex substring in the blob.
    const hex = [...seed].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(serialized).not.toContain(hex);
    expect(vault.kdf).toBe('PBKDF2');
    expect(vault.iterations).toBeGreaterThanOrEqual(600_000);
  });
});
