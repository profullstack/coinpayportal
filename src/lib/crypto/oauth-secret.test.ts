import { describe, expect, it } from 'vitest';
import { decryptClientSecret, encryptClientSecret, needsUpgrade, PBKDF2_ITERATIONS } from './oauth-secret';

/** Build a v1 (200k) ciphertext the way the old client did. */
async function legacyV1(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
  return `v1:${b64(salt)}:${b64(iv)}:${b64(ct)}`;
}

describe('oauth client secret encryption', () => {
  it('uses 600k PBKDF2 iterations for new ciphertext', async () => {
    expect(PBKDF2_ITERATIONS.v2).toBeGreaterThanOrEqual(600_000);
    const ct = await encryptClientSecret('cs_secret', 'correct horse');
    expect(ct.startsWith('v2:')).toBe(true);
    expect(needsUpgrade(ct)).toBe(false);
    expect(await decryptClientSecret(ct, 'correct horse')).toBe('cs_secret');
  });

  it('still opens a v1 copy and flags it for upgrade', async () => {
    const v1 = await legacyV1('cs_old', 'pw-old-format');
    expect(needsUpgrade(v1)).toBe(true);
    const plain = await decryptClientSecret(v1, 'pw-old-format');
    expect(plain).toBe('cs_old');
    const upgraded = await encryptClientSecret(plain, 'pw-old-format');
    expect(needsUpgrade(upgraded)).toBe(false);
    expect(await decryptClientSecret(upgraded, 'pw-old-format')).toBe('cs_old');
  });

  it('rejects a wrong passphrase', async () => {
    const ct = await encryptClientSecret('cs_secret', 'right');
    await expect(decryptClientSecret(ct, 'wrong')).rejects.toThrow('Wrong passphrase');
  });
});
