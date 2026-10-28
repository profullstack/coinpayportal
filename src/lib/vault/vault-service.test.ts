import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'crypto';

vi.mock('server-only', () => ({}));

// A one-table fake of secret_vaults.
const rows = new Map<string, unknown>();
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'secret_vaults') throw new Error(`unexpected table ${table}`);
      const filters: Record<string, string> = {};
      const q: any = {
        select: () => q,
        eq: (col: string, v: string) => {
          filters[col] = v;
          return q;
        },
        maybeSingle: async () => {
          const rec = rows.get(`${filters.subject_type}:${filters.subject_id}`);
          return { data: rec ? { record: rec } : null, error: null };
        },
        insert: async (row: any) => {
          const k = `${row.subject_type}:${row.subject_id}`;
          if (rows.has(k)) return { error: { code: '23505', message: 'duplicate' } };
          rows.set(k, row.record);
          return { error: null };
        },
      };
      return q;
    },
  }),
}));

import { createVault as buildVault, bytesToBase64, isSealed } from './sealed-vault';
import {
  createVault,
  openForMerchant,
  sealForMerchant,
  unlockVault,
  lockVault,
  VaultLockedError,
  VaultMissingError,
} from './vault-service';
import { openMerchantSecret } from './merchant-secret';
import { resetUnlockStore } from './unlock-store';
import { encrypt, decrypt } from '../crypto/encryption';

let n = 0;
async function newMerchant() {
  const id = `m-${++n}`;
  const { record, dek } = await buildVault('correct horse battery', 'merchant', id);
  await createVault('merchant', id, record);
  return { id, dek };
}

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('hex'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetUnlockStore();
});

describe('vault service', () => {
  it('seals while locked, opens only while unlocked', async () => {
    const { id, dek } = await newMerchant();
    const sealed = await sealForMerchant(id, 'paypal-secret', 'aad');
    await expect(openForMerchant(id, sealed, 'aad')).rejects.toBeInstanceOf(VaultLockedError);
    await unlockVault('merchant', id, bytesToBase64(dek), 3600_000);
    expect(await openForMerchant(id, sealed, 'aad')).toBe('paypal-secret');
    lockVault('merchant', id);
    await expect(openForMerchant(id, sealed, 'aad')).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('a restart locks everything', async () => {
    const { id, dek } = await newMerchant();
    const sealed = await sealForMerchant(id, 's', 'aad');
    await unlockVault('merchant', id, bytesToBase64(dek), 3600_000);
    resetUnlockStore();
    await expect(openForMerchant(id, sealed, 'aad')).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('refuses a wrong data key and never unlocks with it', async () => {
    const { id } = await newMerchant();
    await expect(unlockVault('merchant', id, bytesToBase64(randomBytes(32)), null)).rejects.toThrow('Wrong key');
    await expect(unlockVault('merchant', id, 'not-base64!!', null)).rejects.toThrow(/data_key/);
  });

  it('no vault means no sealing and no unlock', async () => {
    await expect(sealForMerchant('nobody', 's', 'aad')).rejects.toBeInstanceOf(VaultMissingError);
    await expect(unlockVault('merchant', 'nobody', bytesToBase64(randomBytes(32)), null)).rejects.toBeInstanceOf(VaultMissingError);
  });

  it('never replaces an existing vault', async () => {
    const { id } = await newMerchant();
    const { record } = await buildVault('another passphrase', 'merchant', id);
    await expect(createVault('merchant', id, record)).rejects.toThrow(/already exists/);
  });

  it('ENCRYPTION_KEY in env opens nothing (no env fallback)', async () => {
    const { id } = await newMerchant();
    const sealed = await sealForMerchant(id, 'secret', 'aad');
    expect(process.env.ENCRYPTION_KEY).toBeTruthy();
    await expect(openForMerchant(id, sealed, 'aad')).rejects.toBeInstanceOf(VaultLockedError);
  });
});

describe('legacy merchant secrets', () => {
  const legacy = () => encrypt('legacy-plaid-token', process.env.ENCRYPTION_KEY!);
  const legacyDecrypt = (v: string) => decrypt(v, process.env.ENCRYPTION_KEY!);

  it('open only while unlocked, and are re-sealed on that use', async () => {
    const { id, dek } = await newMerchant();
    const persist = vi.fn(async () => undefined);
    await expect(openMerchantSecret({ merchantId: id, stored: legacy(), aad: 'a', legacyDecrypt, persist })).rejects.toBeInstanceOf(VaultLockedError);
    expect(persist).not.toHaveBeenCalled();

    await unlockVault('merchant', id, bytesToBase64(dek), 3600_000);
    expect(await openMerchantSecret({ merchantId: id, stored: legacy(), aad: 'a', legacyDecrypt, persist })).toBe('legacy-plaid-token');
    expect(persist).toHaveBeenCalledTimes(1);
    const resealed = (persist.mock.calls[0] as unknown as [string])[0];
    expect(isSealed(resealed)).toBe(true);
    expect(await openForMerchant(id, resealed, 'a')).toBe('legacy-plaid-token');
  });

  it('without a vault the merchant must set one up first', async () => {
    await expect(
      openMerchantSecret({ merchantId: 'no-vault', stored: legacy(), aad: 'a', legacyDecrypt, persist: async () => undefined }),
    ).rejects.toBeInstanceOf(VaultMissingError);
  });

  it('the LEGACY_KEY_MIGRATION=off cutoff closes the legacy path', async () => {
    const { id, dek } = await newMerchant();
    await unlockVault('merchant', id, bytesToBase64(dek), 3600_000);
    vi.stubEnv('LEGACY_KEY_MIGRATION', 'off');
    await expect(
      openMerchantSecret({ merchantId: id, stored: legacy(), aad: 'a', legacyDecrypt, persist: async () => undefined }),
    ).rejects.toThrow(/migration window is closed/);
  });
});
