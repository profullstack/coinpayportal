import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'crypto';

/**
 * Re-key of the operator vault (leaked passphrase): every sealed value moves to
 * a brand-new vault, the old passphrase no longer opens the live data, the old
 * passphrase can still restore from the backup, and dropping the backup ends
 * that. Runs against an in-memory stand-in for the Supabase tables.
 */
const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, seq: 0 }));
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
      let payload: any = null;
      let range: [number, number] | null = null;
      const key = (r: any) => (table === 'secret_vaults' ? `${r.subject_type}:${r.subject_id}` : (r.name ?? r.id));
      const run = () => {
        const rows = (db.tables[table] ??= []);
        if (op === 'insert' || op === 'upsert') {
          for (const p of Array.isArray(payload) ? payload : [payload]) {
            const row = { ...p };
            if (table === 'operator_rekey_backup') row.id = ++db.seq;
            if (op === 'insert' && table !== 'operator_rekey_backup' && rows.some((r) => key(r) === key(row))) {
              return { error: { code: '23505', message: 'duplicate key' } };
            }
            const i = rows.findIndex((r) => table !== 'operator_rekey_backup' && key(r) === key(row));
            if (i >= 0) rows[i] = { ...rows[i], ...row };
            else rows.push(row);
          }
          return { error: null };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          hit.forEach((r) => Object.assign(r, payload));
          return { error: null, count: hit.length };
        }
        if (op === 'delete') {
          db.tables[table] = rows.filter((r) => !hit.includes(r));
          return { error: null };
        }
        const data = range ? hit.slice(range[0], range[1] + 1) : hit;
        return { data: data.map((r) => ({ ...r })), error: null };
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        like: (c: string, pat: string) => (filters.push((r) => typeof r[c] === 'string' && r[c].startsWith(pat.replace(/%$/, ''))), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        order: () => q,
        range: (a: number, b: number) => ((range = [a, b]), q),
        insert: (p: any) => ((op = 'insert'), (payload = p), q),
        upsert: (p: any) => ((op = 'upsert'), (payload = p), q),
        update: (p: any) => ((op = 'update'), (payload = p), q),
        delete: () => ((op = 'delete'), q),
        maybeSingle: async () => {
          const r = run() as any;
          return { data: r.data?.[0] ?? null, error: null };
        },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  }),
}));

const ok = await import('./operator-keys');
const sv = await import('../vault/sealed-vault');
const svc = await import('../vault/vault-service');
const { resetUnlockStore, unlockStatus } = await import('../vault/unlock-store');

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OLD = 'old leaked passphrase';
const NEW = 'brand new passphrase';
const ID = 'coinpay';

async function liveVaultWithSecrets() {
  const { record, dek } = await sv.createVault(OLD, 'operator', ID);
  await svc.createVault('operator', ID, record);
  await ok.sealEnvMnemonics();
  await ok.unlockOperatorKeys(sv.bytesToBase64(dek), 3600_000);
  db.tables.payment_addresses = [];
  db.tables.operator_address_pool = [];
  for (let i = 0; i < 3; i++) {
    const address = `0xaddr${i}`;
    db.tables.payment_addresses.push({ id: `pa-${i}`, address, encrypted_private_key: await ok.sealPaymentAddressKey(address, `priv-${i}`) });
  }
  db.tables.operator_address_pool.push({ id: 'pool-0', address: '0xpool0', sealed_private_key: await ok.sealPaymentAddressKey('0xpool0', 'priv-pool') });
  return { oldRecord: record };
}

const open = (row: any) => ok.openPaymentAddressKey(row);

beforeEach(() => {
  db.tables = {};
  db.seq = 0;
  resetUnlockStore();
  ok.resetOperatorState();
  svc.resetVaultCache();
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('SYSTEM_MNEMONIC_ETH', PHRASE);
});
afterEach(() => vi.unstubAllEnvs());

describe('operator vault re-key', () => {
  it('needs the current vault unlocked', async () => {
    const { record } = await sv.createVault(OLD, 'operator', ID);
    await svc.createVault('operator', ID, record);
    await ok.sealEnvMnemonics();
    const next = await sv.createVault(NEW, 'operator', ID);
    await expect(ok.rekeyOperatorVault(next.record, sv.bytesToBase64(next.dek))).rejects.toThrow(/Unlock/);
  });

  it('moves every secret to the new vault, keeps the unlock, and the old passphrase no longer opens live data', async () => {
    const { oldRecord } = await liveVaultWithSecrets();
    const before = unlockStatus('operator', ID).expiresAt;
    const next = await sv.createVault(NEW, 'operator', ID);
    const out = await ok.rekeyOperatorVault(next.record, sv.bytesToBase64(next.dek));

    expect(out).toMatchObject({ mnemonicBundles: 1, paymentKeys: 3, poolKeys: 1, written: 5, secondPass: 0 });
    expect(out.retiredVault).toMatch(/^coinpay:retired:/);
    // Still unlocked, same expiry, and every key opens with the new vault.
    expect(unlockStatus('operator', ID).unlocked).toBe(true);
    expect(unlockStatus('operator', ID).expiresAt).toBe(before);
    for (let i = 0; i < 3; i++) expect(await open(db.tables.payment_addresses[i])).toBe(`priv-${i}`);
    const pool = db.tables.operator_address_pool[0];
    expect(await open({ address: pool.address, encrypted_private_key: pool.sealed_private_key })).toBe('priv-pool');
    // The live vault is the new one; the old passphrase cannot unwrap it.
    const live = db.tables.secret_vaults.find((r) => r.subject_id === ID).record;
    expect(live.public_key).toBe(next.record.public_key);
    await expect(sv.unwrapDek(live, OLD, 'operator', ID)).rejects.toThrow();
    // The old vault is kept, with one backup row per value, still sealed to the OLD key.
    expect(db.tables.secret_vaults.find((r) => r.subject_id === out.retiredVault).record.public_key).toBe(oldRecord.public_key);
    expect(db.tables.operator_rekey_backup.filter((r) => r.rekey_id === out.retiredVault)).toHaveLength(5);
    // A restart, then an unlock with the NEW passphrase, opens the mnemonics.
    resetUnlockStore();
    ok.resetOperatorState();
    const dek = await sv.unwrapDek(live, NEW, 'operator', ID);
    const { names } = await ok.unlockOperatorKeys(sv.bytesToBase64(dek), 3600_000);
    expect(names).toEqual(['SYSTEM_MNEMONIC_ETH']);
    expect(ok.readSystemMnemonicVar('SYSTEM_MNEMONIC_ETH')).toBe(PHRASE);
  });

  it('refuses to reuse the current key pair', async () => {
    const { oldRecord } = await liveVaultWithSecrets();
    const dek = await sv.unwrapDek(oldRecord, OLD, 'operator', ID);
    await expect(ok.rekeyOperatorVault(oldRecord, sv.bytesToBase64(dek))).rejects.toThrow(/new key pair/);
  });

  it('changes nothing when a value does not open with the current key', async () => {
    await liveVaultWithSecrets();
    const stranger = await sv.createVault('someone else', 'operator', ID);
    db.tables.payment_addresses.push({
      id: 'pa-bad',
      address: '0xbad',
      encrypted_private_key: await sv.sealToPublicKey(stranger.record.public_key, 'x', ok.paymentAddressKeyAad('0xbad')),
    });
    const snapshot = JSON.stringify(db.tables);
    const next = await sv.createVault(NEW, 'operator', ID);
    await expect(ok.rekeyOperatorVault(next.record, sv.bytesToBase64(next.dek))).rejects.toThrow(/did not open.*nothing was changed/);
    expect(JSON.stringify(db.tables)).toBe(snapshot);
  });

  it('restores everything with the OLD passphrase, then a drop removes that path', async () => {
    const { oldRecord } = await liveVaultWithSecrets();
    const next = await sv.createVault(NEW, 'operator', ID);
    const { retiredVault } = await ok.rekeyOperatorVault(next.record, sv.bytesToBase64(next.dek));

    // Locked out of the new vault: restore with the old passphrase.
    const oldDek = await sv.unwrapDek(oldRecord, OLD, 'operator', ID);
    await expect(ok.restoreRekeyBackup(retiredVault, sv.bytesToBase64(next.dek))).rejects.toThrow(); // the new key is not the old one
    const out = await ok.restoreRekeyBackup(retiredVault, sv.bytesToBase64(oldDek));
    expect(out.restored).toBe(5);
    expect(unlockStatus('operator', ID).unlocked).toBe(false);
    const live = db.tables.secret_vaults.find((r) => r.subject_id === ID).record;
    expect(live.public_key).toBe(oldRecord.public_key);
    // The new vault is kept as retired, not deleted.
    expect(db.tables.secret_vaults.find((r) => r.subject_id === out.activeRetiredAs).record.public_key).toBe(next.record.public_key);
    await ok.unlockOperatorKeys(sv.bytesToBase64(await sv.unwrapDek(live, OLD, 'operator', ID)), 3600_000);
    for (let i = 0; i < 3; i++) expect(await open(db.tables.payment_addresses[i])).toBe(`priv-${i}`);

    // Dropping a backup deletes its rows and the retired vault.
    await ok.dropRekeyBackup(out.activeRetiredAs);
    expect(db.tables.secret_vaults.some((r) => r.subject_id === out.activeRetiredAs)).toBe(false);
    await expect(ok.dropRekeyBackup('coinpay')).rejects.toThrow(/Not a retired/);
  });

  it('verifyVaultKey accepts the right data key and rejects another', async () => {
    const { oldRecord } = await liveVaultWithSecrets();
    const dek = await sv.unwrapDek(oldRecord, OLD, 'operator', ID);
    await expect(svc.verifyVaultKey('operator', ID, sv.bytesToBase64(dek))).resolves.toBeUndefined();
    await expect(svc.verifyVaultKey('operator', ID, sv.bytesToBase64(randomBytes(32)))).rejects.toThrow();
  });
});
