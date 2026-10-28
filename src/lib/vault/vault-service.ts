import { getSupabaseAdmin } from '../supabase/server';
import {
  assertVaultRecord,
  base64ToBytes,
  isSealed,
  openSealed,
  openSealedBinary,
  openSealedBytes,
  openVaultPrivateKey,
  sealBinaryToPublicKey,
  sealBytesToPublicKey,
  sealToPublicKey,
  wipe,
  type VaultRecord,
  type VaultSubjectType,
} from './sealed-vault';
import { clampTtlMs, getUnlockedKey, lockVault, putUnlock, unlockStatus } from './unlock-store';

/**
 * Server side of the secrets vault: where records live (public.secret_vaults),
 * how an owner unlocks, and how features seal and open their secrets.
 *
 *   sealFor(...)  works any time (public key only), so a bank can be linked or
 *                 a payout wallet generated while the vault is locked;
 *   openFor(...)  needs an unlock in this process, else VaultLockedError.
 */

export const OPERATOR_SUBJECT_ID = 'coinpay';

export class VaultLockedError extends Error {
  readonly code = 'vault_locked';
  readonly status = 423;
  constructor(
    readonly subjectType: VaultSubjectType,
    message?: string,
  ) {
    super(
      message ??
        (subjectType === 'operator'
          ? 'CoinPay operator keys are locked; an operator must unlock them to resume'
          : 'Locked: unlock your secrets vault at /dashboard/vault to resume'),
    );
    this.name = 'VaultLockedError';
  }
}

export class VaultMissingError extends Error {
  readonly code = 'vault_missing';
  readonly status = 423;
  constructor(
    readonly subjectType: VaultSubjectType,
    message?: string,
  ) {
    super(
      message ??
        (subjectType === 'operator'
          ? 'CoinPay operator vault has not been set up (scripts/operator-vault.mts init)'
          : 'Set up your secrets vault first at /dashboard/vault: CoinPay keeps this secret sealed to a passphrase only you know'),
    );
    this.name = 'VaultMissingError';
  }
}

export function isVaultError(err: unknown): err is VaultLockedError | VaultMissingError {
  return err instanceof VaultLockedError || err instanceof VaultMissingError;
}

/** Public keys are immutable per vault; cache them for sealing. */
const publicKeyCache = new Map<string, string>();

function cacheKey(t: VaultSubjectType, id: string): string {
  return `${t}:${id}`;
}

export async function getVaultRecord(subjectType: VaultSubjectType, subjectId: string): Promise<VaultRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('secret_vaults')
    .select('record')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the secrets vault: ${error.message}`);
  const record = (data?.record as VaultRecord | undefined) ?? null;
  if (record) publicKeyCache.set(cacheKey(subjectType, subjectId), record.public_key);
  return record;
}

export async function getVaultPublicKey(subjectType: VaultSubjectType, subjectId: string): Promise<string | null> {
  const cached = publicKeyCache.get(cacheKey(subjectType, subjectId));
  if (cached) return cached;
  return (await getVaultRecord(subjectType, subjectId))?.public_key ?? null;
}

export async function hasVault(subjectType: VaultSubjectType, subjectId: string): Promise<boolean> {
  return (await getVaultPublicKey(subjectType, subjectId)) !== null;
}

/** Store a new vault. Refuses to replace an existing one (secrets sealed to it would be lost). */
export async function createVault(subjectType: VaultSubjectType, subjectId: string, record: unknown): Promise<VaultRecord> {
  assertVaultRecord(record);
  const { error } = await getSupabaseAdmin()
    .from('secret_vaults')
    .insert({ subject_type: subjectType, subject_id: subjectId, record });
  if (error) {
    if (error.code === '23505') throw new Error('A secrets vault already exists');
    throw new Error(`Could not save the secrets vault: ${error.message}`);
  }
  publicKeyCache.set(cacheKey(subjectType, subjectId), record.public_key);
  return record;
}

/**
 * Replace the passphrase wrapping (after a recovery-key unlock, or a change).
 * The caller proves the DEK; everything that seals secrets must stay identical.
 */
export async function rewrapVault(subjectType: VaultSubjectType, subjectId: string, next: unknown, dataKeyB64: string): Promise<void> {
  assertVaultRecord(next);
  const current = await getVaultRecord(subjectType, subjectId);
  if (!current) throw new VaultMissingError(subjectType);
  if (
    next.public_key !== current.public_key ||
    next.private_key_sealed.ct !== current.private_key_sealed.ct ||
    next.key_check.ct !== current.key_check.ct
  ) {
    throw new Error('Only the passphrase wrapping may change');
  }
  const dek = decodeDataKey(dataKeyB64);
  try {
    await openVaultPrivateKey(next, dek, subjectType, subjectId); // proves the DEK
  } finally {
    wipe(dek);
  }
  const { error } = await getSupabaseAdmin()
    .from('secret_vaults')
    .update({ record: next, updated_at: new Date().toISOString() })
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId);
  if (error) throw new Error(`Could not save the secrets vault: ${error.message}`);
}

function decodeDataKey(dataKeyB64: string): Uint8Array {
  let dek: Uint8Array;
  try {
    dek = base64ToBytes(String(dataKeyB64 ?? ''));
  } catch {
    throw new Error('data_key must be base64');
  }
  if (dek.length !== 32) throw new Error('data_key must be 32 bytes (base64)');
  return dek;
}

/** Unlock: check the presented DEK, keep the private key in memory for the TTL. */
export async function unlockVault(
  subjectType: VaultSubjectType,
  subjectId: string,
  dataKeyB64: string,
  ttlMs?: number | null,
): Promise<{ expiresAt: string }> {
  const record = await getVaultRecord(subjectType, subjectId);
  if (!record) throw new VaultMissingError(subjectType);
  const dek = decodeDataKey(dataKeyB64);
  let privateKey: CryptoKey;
  try {
    privateKey = await openVaultPrivateKey(record, dek, subjectType, subjectId);
  } finally {
    wipe(dek);
  }
  return putUnlock(subjectType, subjectId, privateKey, clampTtlMs(ttlMs, subjectType));
}

export { lockVault, unlockStatus };

export async function vaultStatus(subjectType: VaultSubjectType, subjectId: string) {
  const record = await getVaultRecord(subjectType, subjectId);
  return { exists: !!record, ...unlockStatus(subjectType, subjectId) };
}

/** Seal a secret for a subject. Needs only the public key, so it works while locked. */
export async function sealFor(subjectType: VaultSubjectType, subjectId: string, plaintext: string, aad: string): Promise<string> {
  const pub = await getVaultPublicKey(subjectType, subjectId);
  if (!pub) throw new VaultMissingError(subjectType);
  return sealToPublicKey(pub, plaintext, aad);
}

export async function sealBytesFor(subjectType: VaultSubjectType, subjectId: string, plaintext: Uint8Array, aad: string): Promise<string> {
  const pub = await getVaultPublicKey(subjectType, subjectId);
  if (!pub) throw new VaultMissingError(subjectType);
  return sealBytesToPublicKey(pub, plaintext, aad);
}

/** Open a sealed secret. Throws VaultLockedError unless the subject unlocked in this process. */
export async function openFor(subjectType: VaultSubjectType, subjectId: string, sealed: string, aad: string): Promise<string> {
  const key = getUnlockedKey(subjectType, subjectId);
  if (!key) throw new VaultLockedError(subjectType);
  return openSealed(key, sealed, aad);
}

export async function openBytesFor(subjectType: VaultSubjectType, subjectId: string, sealed: string, aad: string): Promise<Uint8Array> {
  const key = getUnlockedKey(subjectType, subjectId);
  if (!key) throw new VaultLockedError(subjectType);
  return openSealedBytes(key, sealed, aad);
}

/** Binary seal for files (see finances/files.ts). */
export async function sealBinaryFor(subjectType: VaultSubjectType, subjectId: string, plaintext: Uint8Array, aad: string): Promise<Uint8Array> {
  const pub = await getVaultPublicKey(subjectType, subjectId);
  if (!pub) throw new VaultMissingError(subjectType);
  return sealBinaryToPublicKey(pub, plaintext, aad);
}

export async function openBinaryFor(subjectType: VaultSubjectType, subjectId: string, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  const key = getUnlockedKey(subjectType, subjectId);
  if (!key) throw new VaultLockedError(subjectType);
  return openSealedBinary(key, sealed, aad);
}

export { isSealed };

// Merchant shorthands ------------------------------------------------------

export const sealForMerchant = (merchantId: string, plaintext: string, aad: string) => sealFor('merchant', merchantId, plaintext, aad);
export const openForMerchant = (merchantId: string, sealed: string, aad: string) => openFor('merchant', merchantId, sealed, aad);
export const merchantUnlocked = (merchantId: string) => unlockStatus('merchant', merchantId).unlocked;

/** The merchant that owns a business (the vault subject for business-scoped secrets). */
export async function merchantIdForBusiness(businessId: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin().from('businesses').select('merchant_id').eq('id', businessId).maybeSingle();
  return (data?.merchant_id as string | undefined) ?? null;
}

/** Map a vault error to an HTTP body + status, or null if it is not one. */
export function vaultErrorBody(err: unknown): { body: { success: false; error: string; code: string }; status: number } | null {
  if (!isVaultError(err)) return null;
  return { body: { success: false, error: err.message, code: err.code }, status: err.status };
}
