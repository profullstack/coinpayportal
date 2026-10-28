import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';

vi.mock('server-only', () => ({}));
const vaultRows = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const f: Record<string, string> = {};
      const q: any = {
        select: () => q,
        eq: (c: string, v: string) => ((f[c] = v), q),
        maybeSingle: async () => {
          const r = vaultRows.get(`${f.subject_type}:${f.subject_id}`);
          return { data: r ? { record: r } : null, error: null };
        },
      };
      return q;
    },
  }),
}));

const dir = mkdtempSync(path.join(tmpdir(), 'cp-files-'));
process.env.FINANCES_FILES_DIR = dir;
process.env.FINANCES_DOCUMENTS_KEY = randomBytes(32).toString('hex');

const files = await import('./files');
const sv = await import('../vault/sealed-vault');
const svc = await import('../vault/vault-service');
const { resetUnlockStore } = await import('../vault/unlock-store');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function vaultFor(merchantId: string) {
  const v = await sv.createVault('correct horse battery', 'merchant', merchantId);
  vaultRows.set(`merchant:${merchantId}`, v.record);
  return v.dek;
}

beforeEach(() => resetUnlockStore());

describe('finance files sealed to the merchant vault', () => {
  it('statements are sealed inside the document layer; reading needs the unlock', async () => {
    const m = randomUUID();
    const dek = await vaultFor(m);
    const pdf = Buffer.from('%PDF-1.7 account 1234 balance');
    const stored = await files.putObject('statements', m, pdf); // locked: sealing needs only the public key
    await expect(files.getObject(stored.objectKey)).rejects.toBeInstanceOf(svc.VaultLockedError);
    await svc.unlockVault('merchant', m, sv.bytesToBase64(dek), 3600_000);
    expect(await files.getObject(stored.objectKey)).toEqual(pdf);
    // The document key alone yields only the sealed inner layer.
    const onDisk = readFileSync(path.join(dir, ...stored.objectKey.split('/')) + '.bin');
    expect(sv.isSealedBinary(files.decryptBytes(onDisk))).toBe(true);
  });

  it('reports are not merchant-sealed (re-rendered, shared with accountants)', async () => {
    const m = randomUUID();
    await vaultFor(m);
    const stored = await files.putObject('reports', m, Buffer.from('report'));
    expect((await files.getObject(stored.objectKey)).toString()).toBe('report');
  });

  it('legacy objects of a merchant with a vault are re-sealed in place, without an unlock', async () => {
    const m = randomUUID();
    // Written before the vault existed: plain inside the document layer.
    const stored = await files.putObject('documents', m, Buffer.from('w2 form'));
    expect((await files.getObject(stored.objectKey)).toString()).toBe('w2 form'); // no vault yet: legacy readable
    const dek = await vaultFor(m);
    await expect(files.getObject(stored.objectKey)).rejects.toBeInstanceOf(svc.VaultLockedError);
    expect(await files.resealLegacyObjects(m)).toBe(1);
    expect(await files.resealLegacyObjects(m)).toBe(0);
    await svc.unlockVault('merchant', m, sv.bytesToBase64(dek), 3600_000);
    expect((await files.getObject(stored.objectKey)).toString()).toBe('w2 form');
    expect(readdirSync(path.join(dir, 'documents', m))).toHaveLength(1);
  });
});
