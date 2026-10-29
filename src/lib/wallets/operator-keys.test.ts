import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'crypto';

/**
 * Operator keys (SYSTEM_MNEMONIC_*) sealed to the operator vault: env is
 * ignored once sealed, locked means OperatorKeysLockedError, unlock opens
 * them into memory only, a restart locks, and per-address keys follow.
 */
const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
vi.mock('../supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      let op: 'select' | 'insert' | 'upsert' | 'update' = 'select';
      let payload: any = null;
      const run = () => {
        const rows = (db.tables[table] ??= []);
        if (op === 'insert' || op === 'upsert') {
          const key = table === 'secret_vaults' ? (r: any) => `${r.subject_type}:${r.subject_id}` : (r: any) => r.name ?? r.payment_id ?? r.id;
          if (op === 'insert' && rows.some((r) => key(r) === key(payload))) return { error: { code: '23505', message: 'dup' } };
          const i = rows.findIndex((r) => key(r) === key(payload));
          if (i >= 0) rows[i] = { ...rows[i], ...payload };
          else rows.push({ ...payload });
          return { error: null };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') hit.forEach((r) => Object.assign(r, payload));
        return { data: hit, error: null };
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        insert: (p: any) => ((op = 'insert'), (payload = p), q),
        upsert: (p: any) => ((op = 'upsert'), (payload = p), q),
        update: (p: any) => ((op = 'update'), (payload = p), q),
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
const { resetUnlockStore } = await import('../vault/unlock-store');
const { encrypt } = await import('../crypto/encryption');

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function setUpVault() {
  const { record, dek } = await sv.createVault('operator passphrase', 'operator', svc.OPERATOR_SUBJECT_ID);
  await svc.createVault('operator', svc.OPERATOR_SUBJECT_ID, record);
  return sv.bytesToBase64(dek);
}

beforeEach(() => {
  db.tables = {};
  resetUnlockStore();
  ok.resetOperatorState();
  svc.resetVaultCache();
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('SYSTEM_MNEMONIC_ETH', PHRASE);
});
afterEach(() => vi.unstubAllEnvs());

describe('operator keys', () => {
  it('before sealing, mnemonics come from the environment (unchanged behaviour)', async () => {
    await ok.refreshOperatorState(true);
    expect(ok.readSystemMnemonicVar('SYSTEM_MNEMONIC_ETH')).toBe(PHRASE);
  });

  it('once sealed, env is ignored and a locked read throws', async () => {
    await setUpVault();
    await ok.sealEnvMnemonics();
    const stored = db.tables.operator_sealed_secrets[0];
    expect(stored.sealed).toMatch(/^cpv1\./);
    expect(JSON.stringify(stored)).not.toContain('abandon');
    expect(() => ok.readSystemMnemonicVar('SYSTEM_MNEMONIC_ETH')).toThrow(ok.OperatorKeysLockedError);
  });

  it('unlock opens them into memory; lock and restart forget them and alert', async () => {
    const dataKey = await setUpVault();
    await ok.sealEnvMnemonics();
    vi.stubEnv('SYSTEM_MNEMONIC_ETH', ''); // removed from env after sealing
    const { names } = await ok.unlockOperatorKeys(dataKey, null);
    expect(names).toEqual(['SYSTEM_MNEMONIC_ETH']);
    expect(ok.readSystemMnemonicVar('SYSTEM_MNEMONIC_ETH')).toBe(PHRASE);

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(ok.lockOperatorKeys()).toBe(true);
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[ALERT] coinpayportal: operator keys locked'))).toBe(true);
    expect(() => ok.readSystemMnemonicVar('SYSTEM_MNEMONIC_ETH')).toThrow(ok.OperatorKeysLockedError);

    await ok.unlockOperatorKeys(dataKey, null);
    resetUnlockStore(); // restart
    expect(() => ok.readSystemMnemonicVar('SYSTEM_MNEMONIC_ETH')).toThrow(ok.OperatorKeysLockedError);
    err.mockRestore();
  });

  it('deploy handoff: export only while unlocked, and the key unlocks a fresh process', async () => {
    const dataKey = await setUpVault();
    await ok.sealEnvMnemonics();
    vi.stubEnv('SYSTEM_MNEMONIC_ETH', '');
    expect(ok.operatorHandoffExport()).toBeNull();
    const { expiresAt } = await ok.unlockOperatorKeys(dataKey, 3600_000);
    const h = ok.operatorHandoffExport();
    expect(h).toEqual({ dataKey, expiresAt });

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetUnlockStore(); // the new process
    ok.resetOperatorState();
    expect(ok.operatorHandoffExport()).toBeNull();
    await ok.unlockOperatorKeys(h!.dataKey, Date.parse(h!.expiresAt) - Date.now());
    expect(ok.readSystemMnemonicVar('SYSTEM_MNEMONIC_ETH')).toBe(PHRASE);
    ok.lockOperatorKeys();
    expect(ok.operatorHandoffExport()).toBeNull();
    err.mockRestore();
  });

  it('a wrong data key never unlocks', async () => {
    await setUpVault();
    await ok.sealEnvMnemonics();
    await expect(ok.unlockOperatorKeys(sv.bytesToBase64(randomBytes(32)), null)).rejects.toThrow('Wrong key');
    expect(ok.isOperatorUnlocked()).toBe(false);
  });

  it('refuses to seal a retired generation', async () => {
    await setUpVault();
    const { mnemonicFingerprint } = await import('./key-generation');
    vi.stubEnv('RETIRED_SYSTEM_MNEMONIC_FINGERPRINTS', mnemonicFingerprint(PHRASE));
    await expect(ok.sealEnvMnemonics()).rejects.toThrow(/retired/);
  });
});

describe('deposit-address keys', () => {
  const address = '0x00000000000000000000000000000000000000ab';
  const pk = 'aa'.repeat(32);

  it('before the vault: ENCRYPTION_KEY, as before', async () => {
    const stored = await ok.sealPaymentAddressKey(address, pk);
    expect(sv.isSealed(stored)).toBe(false);
    expect(await ok.openPaymentAddressKey({ address, encrypted_private_key: stored })).toBe(pk);
  });

  it('with the vault: sealed, opens only while unlocked', async () => {
    const dataKey = await setUpVault();
    await ok.sealEnvMnemonics();
    const stored = await ok.sealPaymentAddressKey(address, pk);
    expect(stored).toMatch(/^cpv1\./);
    await expect(ok.openPaymentAddressKey({ address, encrypted_private_key: stored })).rejects.toBeInstanceOf(ok.OperatorKeysLockedError);
    await ok.unlockOperatorKeys(dataKey, null);
    expect(await ok.openPaymentAddressKey({ address, encrypted_private_key: stored })).toBe(pk);
    await expect(ok.openPaymentAddressKey({ address: '0xother', encrypted_private_key: stored })).rejects.toThrow();
  });

  it('legacy rows: locked refuses, unlocked opens and re-seals', async () => {
    const legacy = encrypt(pk, process.env.ENCRYPTION_KEY!);
    const dataKey = await setUpVault();
    await ok.sealEnvMnemonics();
    await expect(ok.openPaymentAddressKey({ address, encrypted_private_key: legacy })).rejects.toBeInstanceOf(ok.OperatorKeysLockedError);
    await ok.unlockOperatorKeys(dataKey, null);
    const persist = vi.fn(async () => undefined);
    expect(await ok.openPaymentAddressKey({ address, encrypted_private_key: legacy }, persist)).toBe(pk);
    expect((persist.mock.calls[0] as unknown as [string])[0]).toMatch(/^cpv1\./);
  });

  it('parks locked forwarding on the queue without spending an attempt', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = (await import('../supabase/server')).getSupabaseAdmin();
    db.tables.payment_forwarding_queue = [{ payment_id: 'p1', attempts: 2, max_attempts: 5 }];
    await ok.parkForwardingWhileLocked(supabase as any, 'p1');
    const row = db.tables.payment_forwarding_queue.find((r) => r.payment_id === 'p1');
    expect(row.attempts).toBe(2);
    expect(row.status).toBe('retrying');
    expect(Date.parse(row.next_retry_at)).toBeGreaterThan(Date.now());
    err.mockRestore();
  });
});
