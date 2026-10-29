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
import { isSealed } from '../vault/sealed-vault';
import { onVaultLocked, unlockStatus } from '../vault/unlock-store';
import {
  getVaultPublicKey,
  lockVault,
  OPERATOR_SUBJECT_ID,
  openFor,
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
  envWarned: boolean;
  listening: boolean;
}

const STATE_KEY = Symbol.for('coinpay.operator-keys.v1');

function st(): OperatorState {
  const g = globalThis as unknown as Record<symbol, OperatorState | undefined>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { sealed: null, checkedAt: 0, mnemonics: null, handoff: null, lastAlertAt: 0, envWarned: false, listening: false };
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
    return openFor('operator', OPERATOR_SUBJECT_ID, stored, paymentAddressKeyAad(row.address));
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

/** Test seam: what a restart does to this module's state. */
export function resetOperatorState(): void {
  const s = st();
  wipeMnemonics();
  s.sealed = null;
  s.checkedAt = 0;
  s.lastAlertAt = 0;
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
