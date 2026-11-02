/**
 * CoinPay's own operator keys (SYSTEM_MNEMONIC_*), unlock-on-use.
 *
 * Fleet rule 2026-10-28, Round 2: the operator is just a user that unlocks.
 * The mnemonics live sealed in public.operator_sealed_secrets, sealed to the
 * operator secrets vault (subject 'operator'/'coinpay', same format as the
 * merchant vault). An operator unlocks from /admin/operator-vault or
 * scripts/operator-vault-unlock.mts; the opened mnemonics stay in this
 * process's memory only, for the unlock TTL (default and max 7 days).
 *
 * While locked:
 *  - forwarding pauses: /api/payments/:id/forward answers 423 and parks the
 *    payment on the retry queue without spending an attempt; the queue picks
 *    it up after the next unlock;
 *  - new deposit addresses come from a pre-derived pool (operator_address_pool)
 *    filled while unlocked, each key already sealed to the operator public
 *    key, so checkout keeps working; an empty pool refuses that coin only;
 *  - one "[ALERT] coinpayportal: operator keys locked" log line per lock,
 *    repeated at most hourly, for the log-based alerting to pick up.
 *
 * Per-address signing keys (payment_addresses.encrypted_private_key) are
 * sealed to the operator public key (`cpv1.`), not ENCRYPTION_KEY. Legacy rows
 * are re-sealed when the operator vault is set up, or on first use while
 * unlocked.
 *
 * Until the operator vault is set up and the mnemonics sealed, everything
 * behaves as before (env mnemonics, ENCRYPTION_KEY per-row keys). Once sealed,
 * SYSTEM_MNEMONIC_* in the environment are ignored and a warning asks for them
 * to be removed. Nothing here generates, rotates or moves keys or funds.
 */
import { getSupabaseAdmin } from '../supabase/server';
import { decrypt, encrypt } from '../crypto/encryption';
import { requireEncryptionKey } from '../crypto/require-key';
import { legacyKeyMigrationEnabled } from '../crypto/legacy-migration';
import { isSealed, openSealed, sealToPublicKey } from '../vault/sealed-vault';
import { getUnlockedKey, onVaultLocked, putUnlock, unlockStatus } from '../vault/unlock-store';
import {
  getVaultPublicKey,
  lockVault,
  openNewVaultRecord,
  OPERATOR_SUBJECT_ID,
  openFor,
  replaceVaultRecord,
  sealFor,
  unlockVault,
  VaultLockedError,
} from '../vault/vault-service';
import { assertMnemonicNotRetired } from './key-generation';

export const SYSTEM_MNEMONICS_ROW = 'system_mnemonics';
const BUNDLE_AAD = `operator_sealed_secrets:${SYSTEM_MNEMONICS_ROW}`;
const MNEMONIC_VAR = /^SYSTEM_MNEMONIC_[A-Z0-9_]+$/;
const SEALED_CHECK_TTL_MS = 60_000;
const ALERT_REPEAT_MS = 3600_000;

interface OperatorState {
  /** Whether the mnemonics are sealed in the database (null = not checked yet). */
  sealed: boolean | null;
  checkedAt: number;
  /** Opened mnemonics, only while unlocked. */
  mnemonics: Map<string, string> | null;
  /** The data key of the current unlock, kept only to hand it to the next process on deploy. */
  handoff: { dataKey: string; expiresAt: string } | null;
  lastAlertAt: number;
  /** The previous vault's private key, only during a re-key: rows not rewritten yet still open. */
  retiredKey: CryptoKey | null;
  envWarned: boolean;
  listening: boolean;
}

const STATE_KEY = Symbol.for('coinpay.operator-keys.v1');

function st(): OperatorState {
  const g = globalThis as unknown as Record<symbol, OperatorState | undefined>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { sealed: null, checkedAt: 0, mnemonics: null, handoff: null, lastAlertAt: 0, retiredKey: null, envWarned: false, listening: false };
  }
  const s = g[STATE_KEY]!;
  if (!s.listening) {
    s.listening = true;
    onVaultLocked((type, _id, reason) => {
      if (type !== 'operator') return;
      wipeMnemonics();
      operatorAlert(`operator keys locked (${reason}), unlock to resume forwarding`, true);
    });
  }
  return s;
}

/** One log line the log-based alerting (crawlproof/uptime) matches on. */
export function operatorAlert(message: string, force = false): void {
  const s = st();
  const now = Date.now();
  if (!force && now - s.lastAlertAt < ALERT_REPEAT_MS) return;
  s.lastAlertAt = now;
  console.error(`[ALERT] coinpayportal: ${message}`);
}

function wipeMnemonics(): void {
  const s = st();
  s.mnemonics?.clear();
  s.mnemonics = null;
  s.handoff = null;
}

export class OperatorKeysLockedError extends VaultLockedError {
  constructor(message?: string) {
    super('operator', message);
    this.name = 'OperatorKeysLockedError';
  }
}

export function isOperatorUnlocked(): boolean {
  const s = st();
  return unlockStatus('operator', OPERATOR_SUBJECT_ID).unlocked && s.mnemonics !== null;
}

/** Whether the operator mnemonics are sealed (cached for a minute). Call before sync reads. */
export async function refreshOperatorState(force = false): Promise<{ sealed: boolean; unlocked: boolean }> {
  const s = st();
  if (force || s.sealed === null || Date.now() - s.checkedAt > SEALED_CHECK_TTL_MS) {
    const { data, error } = await getSupabaseAdmin()
      .from('operator_sealed_secrets')
      .select('name')
      .eq('name', SYSTEM_MNEMONICS_ROW)
      .maybeSingle();
    if (!error) {
      s.sealed = !!data;
      s.checkedAt = Date.now();
    }
  }
  const sealed = s.sealed === true;
  if (sealed && !s.envWarned && Object.keys(process.env).some((k) => MNEMONIC_VAR.test(k) && process.env[k])) {
    s.envWarned = true;
    console.warn('[operator-keys] SYSTEM_MNEMONIC_* are sealed but still present in the environment; they are ignored. Remove them from app.env and the vault.');
  }
  return { sealed, unlocked: isOperatorUnlocked() };
}

/** Sealed and locked right now (from the cached state). */
export function operatorKeysLocked(): boolean {
  return st().sealed === true && !isOperatorUnlocked();
}

/**
 * Read one SYSTEM_MNEMONIC_* value. Sealed: from the unlock (throws
 * OperatorKeysLockedError while locked; env values are ignored). Not sealed
 * yet: from the environment, as before.
 */
export function readSystemMnemonicVar(name: string): string | undefined {
  const s = st();
  if (s.sealed === true) {
    if (!isOperatorUnlocked()) throw new OperatorKeysLockedError();
    return s.mnemonics!.get(name) || undefined;
  }
  return process.env[name] || undefined;
}

/** Collect the SYSTEM_MNEMONIC_* set from the environment (names only are ever logged). */
export function collectEnvMnemonics(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (MNEMONIC_VAR.test(k) && v && v.trim()) out[k] = v.trim();
  }
  return out;
}

/**
 * Seal the current SYSTEM_MNEMONIC_* from the environment into the operator
 * vault. Needs the vault (public key) only. Refuses retired generations.
 */
export async function sealEnvMnemonics(): Promise<{ sealed: string[] }> {
  const bundle = collectEnvMnemonics();
  const names = Object.keys(bundle).sort();
  if (!names.length) throw new Error('No SYSTEM_MNEMONIC_* found in the environment to seal');
  for (const n of names) assertMnemonicNotRetired(bundle[n], n);
  const sealed = await sealFor('operator', OPERATOR_SUBJECT_ID, JSON.stringify(bundle), BUNDLE_AAD);
  const { error } = await getSupabaseAdmin()
    .from('operator_sealed_secrets')
    .upsert({ name: SYSTEM_MNEMONICS_ROW, sealed, meta: { names }, updated_at: new Date().toISOString() }, { onConflict: 'name' });
  if (error) throw new Error(`Could not store the sealed mnemonics: ${error.message}`);
  await refreshOperatorState(true);
  return { sealed: names };
}

/** Unlock: check the data key, open the mnemonics into memory for the TTL. */
export async function unlockOperatorKeys(dataKeyB64: string, ttlMs?: number | null): Promise<{ expiresAt: string; names: string[] }> {
  const { expiresAt } = await unlockVault('operator', OPERATOR_SUBJECT_ID, dataKeyB64, ttlMs ?? null);
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('operator_sealed_secrets')
      .select('sealed')
      .eq('name', SYSTEM_MNEMONICS_ROW)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.sealed) throw new Error('No sealed mnemonics yet: run setup first');
    const bundle = JSON.parse(await openFor('operator', OPERATOR_SUBJECT_ID, data.sealed as string, BUNDLE_AAD)) as Record<string, string>;
    for (const [k, v] of Object.entries(bundle)) assertMnemonicNotRetired(v, k);
    const s = st();
    wipeMnemonics();
    s.mnemonics = new Map(Object.entries(bundle));
    s.handoff = { dataKey: dataKeyB64, expiresAt };
    s.sealed = true;
    s.checkedAt = Date.now();
    s.lastAlertAt = 0;
    console.log(`[operator-keys] unlocked until ${expiresAt} (${s.mnemonics.size} mnemonics)`);
    return { expiresAt, names: [...s.mnemonics.keys()].sort() };
  } catch (err) {
    lockVault('operator', OPERATOR_SUBJECT_ID, 'unlock failed');
    throw err;
  }
}

/**
 * The current unlock, for handing to the next process on a deploy (see
 * operator-handoff.ts): same data key, same expiry, so a redeploy no longer
 * locks the vault. Null while locked.
 */
export function operatorHandoffExport(): { dataKey: string; expiresAt: string } | null {
  const s = st();
  if (!isOperatorUnlocked() || !s.handoff) return null;
  return { ...s.handoff };
}

export function lockOperatorKeys(): boolean {
  const was = lockVault('operator', OPERATOR_SUBJECT_ID, 'locked by operator');
  wipeMnemonics();
  return was;
}

// ---------------------------------------------------------------------------
// Per-address signing keys (payment_addresses.encrypted_private_key)
// ---------------------------------------------------------------------------

export function paymentAddressKeyAad(address: string): string {
  return `payment_addresses:${address}`;
}

/**
 * Store form of a freshly derived deposit-address key: sealed to the operator
 * public key once the operator vault exists, else ENCRYPTION_KEY (unchanged
 * pre-vault behaviour).
 */
export async function sealPaymentAddressKey(address: string, privateKey: string): Promise<string> {
  const pub = await getVaultPublicKey('operator', OPERATOR_SUBJECT_ID);
  if (pub) return sealFor('operator', OPERATOR_SUBJECT_ID, privateKey, paymentAddressKeyAad(address));
  return encrypt(privateKey, requireEncryptionKey('system wallet'));
}

/**
 * Open a deposit-address key for signing. Sealed rows need the operator
 * unlock. Legacy ENCRYPTION_KEY rows: before the operator vault is set up,
 * opened as before; after, only while unlocked, and re-sealed on the way.
 */
export async function openPaymentAddressKey(
  row: { id?: string; address: string; encrypted_private_key: string },
  persist?: (sealed: string) => Promise<unknown>,
): Promise<string> {
  const stored = row.encrypted_private_key;
  if (isSealed(stored)) {
    if (!unlockStatus('operator', OPERATOR_SUBJECT_ID).unlocked) throw new OperatorKeysLockedError();
    try {
      return await openFor('operator', OPERATOR_SUBJECT_ID, stored, paymentAddressKeyAad(row.address));
    } catch (err) {
      // Mid re-key: this row may still be sealed to the previous vault.
      const retired = st().retiredKey;
      if (!retired) throw err;
      return openSealed(retired, stored, paymentAddressKeyAad(row.address));
    }
  }
  const pub = await getVaultPublicKey('operator', OPERATOR_SUBJECT_ID);
  if (!pub) return decrypt(stored, requireEncryptionKey('forwarding'));
  if (!unlockStatus('operator', OPERATOR_SUBJECT_ID).unlocked) throw new OperatorKeysLockedError();
  if (!legacyKeyMigrationEnabled()) throw new Error('Legacy deposit-address key and LEGACY_KEY_MIGRATION=off');
  const plain = decrypt(stored, requireEncryptionKey('forwarding'));
  if (persist) {
    try {
      await persist(await sealFor('operator', OPERATOR_SUBJECT_ID, plain, paymentAddressKeyAad(row.address)));
    } catch (err) {
      console.error('[operator-keys] re-seal of a legacy address key failed', err instanceof Error ? err.message : err);
    }
  }
  return plain;
}

/**
 * Re-seal every legacy (ENCRYPTION_KEY) payment_addresses key to the operator
 * public key. No unlock needed. Batched; safe to re-run. Returns counts.
 */
export async function resealLegacyPaymentAddressKeys(batch = 500): Promise<{ resealed: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  if (!(await getVaultPublicKey('operator', OPERATOR_SUBJECT_ID))) return { resealed: 0, failed: 0 };
  if (!legacyKeyMigrationEnabled()) return { resealed: 0, failed: 0 };
  const key = requireEncryptionKey('forwarding');
  let resealed = 0;
  let failed = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { data, error } = await supabase
      .from('payment_addresses')
      .select('id, address, encrypted_private_key')
      .gt('id', lastId)
      .not('encrypted_private_key', 'like', 'cpv1.%')
      .order('id', { ascending: true })
      .limit(batch);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data) {
      lastId = row.id as string;
      const stored = row.encrypted_private_key as string | null;
      if (!stored || isSealed(stored)) continue;
      try {
        const sealed = await sealFor('operator', OPERATOR_SUBJECT_ID, decrypt(stored, key), paymentAddressKeyAad(row.address as string));
        const { error: upd } = await supabase
          .from('payment_addresses')
          .update({ encrypted_private_key: sealed })
          .eq('id', row.id)
          .eq('encrypted_private_key', stored);
        if (upd) failed += 1;
        else resealed += 1;
      } catch {
        failed += 1;
      }
    }
    if (data.length < batch) break;
  }
  return { resealed, failed };
}

// ---------------------------------------------------------------------------
// Re-key: move everything to a brand-new vault (new key pair, new data key)
// ---------------------------------------------------------------------------

type RekeySource = 'operator_sealed_secrets' | 'payment_addresses' | 'operator_address_pool';
interface RekeyRow {
  source: RekeySource;
  key: string; // name or id
  aad: string;
  old: string;
  next: string;
}

const PAGE = 1000;

/** Every operator-sealed value: the mnemonic bundle, deposit keys and pool keys. */
async function listOperatorSealed(): Promise<Array<Omit<RekeyRow, 'next'>>> {
  const supabase = getSupabaseAdmin();
  const out: Array<Omit<RekeyRow, 'next'>> = [];
  const { data: bundle, error: bErr } = await supabase
    .from('operator_sealed_secrets')
    .select('name, sealed')
    .eq('name', SYSTEM_MNEMONICS_ROW)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!bundle?.sealed) throw new Error('No sealed mnemonics to re-key');
  out.push({ source: 'operator_sealed_secrets', key: SYSTEM_MNEMONICS_ROW, aad: BUNDLE_AAD, old: bundle.sealed as string });
  for (const [table, col] of [
    ['payment_addresses', 'encrypted_private_key'],
    ['operator_address_pool', 'sealed_private_key'],
  ] as const) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(`id, address, ${col}`)
        .like(col, 'cpv1.%')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const r of (data ?? []) as unknown as Array<Record<string, string>>) {
        out.push({ source: table, key: r.id, aad: paymentAddressKeyAad(r.address), old: r[col] });
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

function columnFor(source: RekeySource): string {
  return source === 'operator_sealed_secrets' ? 'sealed' : source === 'payment_addresses' ? 'encrypted_private_key' : 'sealed_private_key';
}

async function writeRekeyed(rows: RekeyRow[]): Promise<number> {
  const supabase = getSupabaseAdmin();
  let written = 0;
  for (const r of rows) {
    const col = columnFor(r.source);
    const idCol = r.source === 'operator_sealed_secrets' ? 'name' : 'id';
    const { error, count } = await supabase
      .from(r.source)
      .update({ [col]: r.next }, { count: 'exact' })
      .eq(idCol, r.key)
      .eq(col, r.old);
    if (!error && (count ?? 0) > 0) written += 1;
  }
  return written;
}

export interface RekeyResult {
  retiredVault: string;
  mnemonicBundles: number;
  paymentKeys: number;
  poolKeys: number;
  written: number;
  secondPass: number;
  expiresAt: string;
}

/**
 * Move every operator secret to a new vault the operator just created in the
 * browser (new key pair, new data key, new passphrase), while the current
 * vault is unlocked. Nothing is written until every value has been opened with
 * the current key and re-sealed to the new one. Before the swap, the old
 * ciphertexts are copied to operator_rekey_backup and the old vault row is
 * kept (renamed), so the old passphrase can still restore everything until
 * that backup is dropped. The unlock carries over to the new vault with the
 * same expiry.
 */
export async function rekeyOperatorVault(newRecord: unknown, newDataKeyB64: string): Promise<RekeyResult> {
  const oldKey = getUnlockedKey('operator', OPERATOR_SUBJECT_ID);
  const status = unlockStatus('operator', OPERATOR_SUBJECT_ID);
  if (!oldKey || !status.unlocked || !status.expiresAt) throw new OperatorKeysLockedError('Unlock the operator keys first: the re-key opens every secret with the current key');
  const oldPub = await getVaultPublicKey('operator', OPERATOR_SUBJECT_ID);
  const { record, privateKey: newKey } = await openNewVaultRecord('operator', OPERATOR_SUBJECT_ID, newRecord, newDataKeyB64);
  if (record.public_key === oldPub) throw new Error('The new vault must have a new key pair: create it fresh, do not reuse the old record');

  // 1. Open everything with the current key and seal it to the new one. Abort on any failure.
  const listed = await listOperatorSealed();
  const rows: RekeyRow[] = [];
  let failed = 0;
  for (const r of listed) {
    try {
      rows.push({ ...r, next: await sealToPublicKey(record.public_key, await openSealed(oldKey, r.old, r.aad), r.aad) });
    } catch {
      failed += 1;
    }
  }
  if (failed) throw new Error(`${failed} of ${listed.length} sealed values did not open with the current key; nothing was changed`);

  // 2. Back up the old ciphertexts (still sealed to the old key) before touching anything.
  const supabase = getSupabaseAdmin();
  const retiredName = `${OPERATOR_SUBJECT_ID}:retired:pending`;
  const backupRows = rows.map((r) => ({ rekey_id: retiredName, source: r.source, row_key: r.key, aad: r.aad, sealed: r.old }));
  for (let i = 0; i < backupRows.length; i += 500) {
    const { error } = await supabase.from('operator_rekey_backup').insert(backupRows.slice(i, i + 500));
    if (error) {
      await supabase.from('operator_rekey_backup').delete().eq('rekey_id', retiredName);
      throw new Error(`Could not back up the old sealed values; nothing was changed: ${error.message}`);
    }
  }

  // 3. Swap the vault record (old row kept, renamed) and write the new ciphertexts.
  const s = st();
  s.retiredKey = oldKey; // in-flight forwards can still open rows not rewritten yet
  let retiredVault: string;
  try {
    retiredVault = await replaceVaultRecord('operator', OPERATOR_SUBJECT_ID, record);
  } catch (err) {
    s.retiredKey = null;
    await supabase.from('operator_rekey_backup').delete().eq('rekey_id', retiredName);
    throw err;
  }
  await supabase.from('operator_rekey_backup').update({ rekey_id: retiredVault }).eq('rekey_id', retiredName);
  const msLeft = Math.max(60_000, new Date(status.expiresAt).getTime() - Date.now());
  const { expiresAt } = putUnlock('operator', OPERATOR_SUBJECT_ID, newKey, msLeft);
  if (s.handoff) s.handoff = { dataKey: newDataKeyB64, expiresAt };
  const written = await writeRekeyed(rows);

  // 4. Second pass: anything minted with the old public key while this ran.
  let secondPass = 0;
  const again = await listOperatorSealed();
  for (const r of again) {
    try {
      await openSealed(newKey, r.old, r.aad);
    } catch {
      try {
        const next = await sealToPublicKey(record.public_key, await openSealed(oldKey, r.old, r.aad), r.aad);
        await supabase.from('operator_rekey_backup').insert({ rekey_id: retiredVault, source: r.source, row_key: r.key, aad: r.aad, sealed: r.old });
        secondPass += await writeRekeyed([{ ...r, next }]);
      } catch (err) {
        console.error(`[operator-keys] re-key second pass failed for ${r.source} ${r.key}`, err instanceof Error ? err.message : err);
      }
    }
  }
  s.retiredKey = null;
  const count = (src: RekeySource) => rows.filter((r) => r.source === src).length;
  console.log(`[operator-keys] re-keyed to a new vault; old vault kept as ${retiredVault}; unlocked until ${expiresAt}`);
  return {
    retiredVault,
    mnemonicBundles: count('operator_sealed_secrets'),
    paymentKeys: count('payment_addresses'),
    poolKeys: count('operator_address_pool'),
    written,
    secondPass,
    expiresAt,
  };
}

/**
 * The restore path, and when to drop it. List re-key backups (sealed to the
 * retired vaults), or delete one backup together with its retired vault row
 * once the new passphrase is proven.
 */
export async function listRekeyBackups(): Promise<Array<{ retiredVault: string; values: number }>> {
  const { data, error } = await getSupabaseAdmin().from('operator_rekey_backup').select('rekey_id');
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.rekey_id as string, (counts.get(r.rekey_id as string) ?? 0) + 1);
  return [...counts].map(([retiredVault, values]) => ({ retiredVault, values }));
}

/**
 * Restore with the OLD passphrase: make a retired vault active again and put
 * its backed-up ciphertexts back. The data key must open the retired vault.
 * The current vault is retired in turn (kept, not deleted). Values minted
 * after the re-key are sealed to the current vault and stay as they are; they
 * open again once it is restored the same way, or re-derive from the seeds.
 */
export async function restoreRekeyBackup(retiredVault: string, oldDataKeyB64: string): Promise<{ restored: number; activeRetiredAs: string }> {
  if (!retiredVault.startsWith(`${OPERATOR_SUBJECT_ID}:retired:`)) throw new Error('Not a retired operator vault');
  const supabase = getSupabaseAdmin();
  const { data: row, error } = await supabase
    .from('secret_vaults')
    .select('record')
    .eq('subject_type', 'operator')
    .eq('subject_id', retiredVault)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.record) throw new Error('That retired vault no longer exists');
  // Proves the old passphrase (the record's AAD is bound to the live subject id).
  const { record } = await openNewVaultRecord('operator', OPERATOR_SUBJECT_ID, row.record, oldDataKeyB64);
  const { data: backups, error: bErr } = await supabase
    .from('operator_rekey_backup')
    .select('source, row_key, sealed')
    .eq('rekey_id', retiredVault);
  if (bErr) throw new Error(bErr.message);
  lockOperatorKeys();
  const activeRetiredAs = await replaceVaultRecord('operator', OPERATOR_SUBJECT_ID, record);
  await supabase.from('secret_vaults').delete().eq('subject_type', 'operator').eq('subject_id', retiredVault);
  let restored = 0;
  for (const b of backups ?? []) {
    const source = b.source as RekeySource;
    const idCol = source === 'operator_sealed_secrets' ? 'name' : 'id';
    const { error: uErr } = await supabase.from(source).update({ [columnFor(source)]: b.sealed }).eq(idCol, b.row_key as string);
    if (!uErr) restored += 1;
  }
  console.log(`[operator-keys] restored retired vault ${retiredVault} (${restored} values); previous vault kept as ${activeRetiredAs}; unlock to resume`);
  return { restored, activeRetiredAs };
}

export async function dropRekeyBackup(retiredVault: string): Promise<void> {
  if (!retiredVault.startsWith(`${OPERATOR_SUBJECT_ID}:retired:`)) throw new Error('Not a retired operator vault');
  const supabase = getSupabaseAdmin();
  const { error: e1 } = await supabase.from('operator_rekey_backup').delete().eq('rekey_id', retiredVault);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabase.from('secret_vaults').delete().eq('subject_type', 'operator').eq('subject_id', retiredVault);
  if (e2) throw new Error(e2.message);
}

/** Test seam: what a restart does to this module's state. */
export function resetOperatorState(): void {
  const s = st();
  wipeMnemonics();
  s.sealed = null;
  s.checkedAt = 0;
  s.lastAlertAt = 0;
  s.retiredKey = null;
  s.envWarned = false;
}

export const FORWARDING_LOCKED_RETRY_MS = 15 * 60_000;

/**
 * A payment that could not forward because the operator keys are locked:
 * put it on the retry queue for after the unlock, without spending a retry
 * attempt (a lock is not a failure), and raise the alert line.
 */
export async function parkForwardingWhileLocked(
  supabase: { from: (t: string) => any },
  paymentId: string,
): Promise<void> {
  operatorAlert('operator keys locked: forwarding paused, unlock to resume');
  const { data } = await supabase.from('payment_forwarding_queue').select('attempts, max_attempts').eq('payment_id', paymentId).maybeSingle();
  await supabase.from('payment_forwarding_queue').upsert(
    {
      payment_id: paymentId,
      status: 'retrying',
      attempts: (data?.attempts as number | undefined) ?? 0,
      ...(data?.max_attempts ? {} : { max_attempts: 5 }),
      next_retry_at: new Date(Date.now() + FORWARDING_LOCKED_RETRY_MS).toISOString(),
      last_error: 'operator keys locked: waiting for an operator unlock',
      last_response: { status: 423, code: 'operator_locked' },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'payment_id' },
  );
}
