import { describe, it, expect } from 'vitest';
import { assertVaultRecord, openVaultPrivateKey, createVault, bytesToBase64 } from './sealed-vault';
// The CLI's port (packages/sdk/src/secrets-vault.js) must stay byte-compatible.
import { createVaultRecord, unwrapDek } from '../../../packages/sdk/src/secrets-vault.js';

const SUBJECT = '5d79f032-b9ec-42b6-a34a-577c9ab9688d';

describe('CLI secrets vault interop', () => {
  it('a record built by the CLI passes the server checks and opens with its DEK', async () => {
    const { record, dek, recoveryKey } = await createVaultRecord('correct horse battery', SUBJECT);
    expect(() => assertVaultRecord(record)).not.toThrow();
    await expect(openVaultPrivateKey(record, dek, 'merchant', SUBJECT)).resolves.toBeTruthy();
    const again = await unwrapDek(record, SUBJECT, { passphrase: 'correct horse battery' });
    expect(bytesToBase64(again)).toBe(bytesToBase64(dek));
    const viaRecovery = await unwrapDek(record, SUBJECT, { recoveryKey: recoveryKey! });
    expect(bytesToBase64(viaRecovery)).toBe(bytesToBase64(dek));
    await expect(unwrapDek(record, SUBJECT, { passphrase: 'wrong passphrase' })).rejects.toThrow('Wrong passphrase');
    await expect(unwrapDek(record, 'another-merchant', { passphrase: 'correct horse battery' })).rejects.toThrow();
  });

  it('the CLI unwraps a vault the dashboard created', async () => {
    const { record, dek } = await createVault('dashboard passphrase', 'merchant', SUBJECT);
    const out = await unwrapDek(record, SUBJECT, { passphrase: 'dashboard passphrase' });
    expect(bytesToBase64(out)).toBe(bytesToBase64(dek));
  });
});
