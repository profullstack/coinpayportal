import { describe, expect, it } from 'vitest';
import {
  createVault,
  decodeRecoveryKey,
  encodeRecoveryKey,
  isSealed,
  isSealedBinary,
  openSealed,
  openSealedBinary,
  openVaultPrivateKey,
  rewrapWithPassphrase,
  sealBinaryToPublicKey,
  sealToPublicKey,
  unwrapDek,
  unwrapDekWithRecovery,
  assertVaultRecord,
  randomBytes,
} from './sealed-vault';

const M = 'merchant-1';
// Lower iterations are refused by policy; tests use the real 600k (a few hundred ms).

describe('secrets vault', () => {
  it('seals to the public key and opens only with the unlocked private key', async () => {
    const { record, dek, recoveryKey } = await createVault('correct horse battery', 'merchant', M);
    assertVaultRecord(record);
    expect(recoveryKey).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{1,4})+$/);
    const sealed = await sealToPublicKey(record.public_key, 'plaid-access-token', 'finance_connections:m1:credential');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('plaid-access-token');

    const key = await openVaultPrivateKey(record, dek, 'merchant', M);
    expect(await openSealed(key, sealed, 'finance_connections:m1:credential')).toBe('plaid-access-token');
  });

  it('passphrase and recovery key both yield the same data key', async () => {
    const { record, dek, recoveryKey } = await createVault('correct horse battery', 'merchant', M);
    expect(Buffer.from(await unwrapDek(record, 'correct horse battery', 'merchant', M))).toEqual(Buffer.from(dek));
    expect(Buffer.from(await unwrapDekWithRecovery(record, recoveryKey!, 'merchant', M))).toEqual(Buffer.from(dek));
  });

  it('refuses a wrong passphrase, a wrong recovery key and a wrong data key', async () => {
    const { record } = await createVault('correct horse battery', 'merchant', M);
    await expect(unwrapDek(record, 'wrong passphrase!', 'merchant', M)).rejects.toThrow('Wrong passphrase');
    await expect(unwrapDekWithRecovery(record, encodeRecoveryKey(randomBytes(32)), 'merchant', M)).rejects.toThrow('Wrong recovery key');
    await expect(openVaultPrivateKey(record, randomBytes(32), 'merchant', M)).rejects.toThrow('Wrong key');
  });

  it('binds the vault to its subject', async () => {
    const { record, dek } = await createVault('correct horse battery', 'merchant', M);
    await expect(unwrapDek(record, 'correct horse battery', 'merchant', 'merchant-2')).rejects.toThrow();
    await expect(openVaultPrivateKey(record, dek, 'operator', M)).rejects.toThrow();
  });

  it('a sealed value will not open under another AAD or once tampered with', async () => {
    const { record, dek } = await createVault('correct horse battery', 'merchant', M);
    const key = await openVaultPrivateKey(record, dek, 'merchant', M);
    const sealed = await sealToPublicKey(record.public_key, 'secret', 'aad-a');
    await expect(openSealed(key, sealed, 'aad-b')).rejects.toThrow();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    await expect(openSealed(key, tampered, 'aad-a')).rejects.toThrow();
  });

  it('another vault cannot open it', async () => {
    const a = await createVault('correct horse battery', 'merchant', M);
    const b = await createVault('correct horse battery', 'merchant', M);
    const sealed = await sealToPublicKey(a.record.public_key, 'secret', 'x');
    const keyB = await openVaultPrivateKey(b.record, b.dek, 'merchant', M);
    await expect(openSealed(keyB, sealed, 'x')).rejects.toThrow();
  });

  it('binary seal round-trips files', async () => {
    const { record, dek } = await createVault('correct horse battery', 'merchant', M);
    const data = randomBytes(5000);
    const sealed = await sealBinaryToPublicKey(record.public_key, data, 'finance_files:k');
    expect(isSealedBinary(sealed)).toBe(true);
    expect(isSealedBinary(data)).toBe(false);
    const key = await openVaultPrivateKey(record, dek, 'merchant', M);
    expect(Buffer.from(await openSealedBinary(key, sealed, 'finance_files:k'))).toEqual(Buffer.from(data));
    await expect(openSealedBinary(key, sealed, 'finance_files:other')).rejects.toThrow();
  });

  it('a new passphrase re-wraps the same data key; sealed secrets are untouched', async () => {
    const { record, dek } = await createVault('correct horse battery', 'merchant', M);
    const next = await rewrapWithPassphrase(record, dek, 'a brand new passphrase', 'merchant', M);
    expect(next.public_key).toBe(record.public_key);
    expect(Buffer.from(await unwrapDek(next, 'a brand new passphrase', 'merchant', M))).toEqual(Buffer.from(dek));
    await expect(unwrapDek(next, 'correct horse battery', 'merchant', M)).rejects.toThrow();
  });

  it('enforces passphrase length and KDF policy', async () => {
    await expect(createVault('short', 'merchant', M)).rejects.toThrow(/at least/);
    const { record } = await createVault('correct horse battery', 'merchant', M);
    expect(() => assertVaultRecord({ ...record, kdf: { ...record.kdf, iterations: 100_000 } })).toThrow(/iterations/);
    expect(() => assertVaultRecord({ ...record, public_key: 'AAAA' })).toThrow(/public key/);
  });

  it('recovery key text round-trips', () => {
    const raw = randomBytes(32);
    expect(Buffer.from(decodeRecoveryKey(encodeRecoveryKey(raw)))).toEqual(Buffer.from(raw));
    expect(() => decodeRecoveryKey('ABCD')).toThrow();
  });
});
