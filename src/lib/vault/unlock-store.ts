/**
 * In-memory unlock sessions for secrets vaults.
 *
 * An unlock holds the vault's (non-extractable) private key in THIS process's
 * memory only: never the database, Redis, disk, logs or process.env. Every
 * unlock has a TTL (default 8h for merchants, 7d for the operator, max 7d) and
 * can be ended early with lock(). A restart drops every unlock, so the jobs
 * that need a vault pause with a "locked" status until the owner unlocks again.
 *
 * Kept on globalThis under a Symbol so every Next.js route bundle and the
 * instrumentation-started workers share one store in a process.
 */
import type { VaultSubjectType } from './sealed-vault';

export const MAX_UNLOCK_TTL_MS = 7 * 24 * 3600_000;
export const DEFAULT_MERCHANT_TTL_MS = 8 * 3600_000;
export const DEFAULT_OPERATOR_TTL_MS = 7 * 24 * 3600_000;
const MIN_TTL_MS = 60_000;

interface UnlockEntry {
  privateKey: CryptoKey;
  unlockedAt: number;
  expiresAt: number;
}

interface StoreState {
  entries: Map<string, UnlockEntry>;
  /** Called once per transition to locked (expiry, lock(), or first use after a restart). */
  onLocked: Array<(subjectType: VaultSubjectType, subjectId: string, reason: string) => void>;
}

const STORE_KEY = Symbol.for('coinpay.vault.unlock-store.v1');

function state(): StoreState {
  const g = globalThis as unknown as Record<symbol, StoreState | undefined>;
  if (!g[STORE_KEY]) g[STORE_KEY] = { entries: new Map(), onLocked: [] };
  return g[STORE_KEY]!;
}

function keyOf(subjectType: VaultSubjectType, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

export function clampTtlMs(requestedMs: number | null | undefined, subjectType: VaultSubjectType): number {
  const fallback = subjectType === 'operator' ? DEFAULT_OPERATOR_TTL_MS : DEFAULT_MERCHANT_TTL_MS;
  const ms = typeof requestedMs === 'number' && Number.isFinite(requestedMs) && requestedMs > 0 ? requestedMs : fallback;
  return Math.min(Math.max(ms, MIN_TTL_MS), MAX_UNLOCK_TTL_MS);
}

export function putUnlock(
  subjectType: VaultSubjectType,
  subjectId: string,
  privateKey: CryptoKey,
  ttlMs: number,
  now: number = Date.now(),
): { expiresAt: string } {
  const ttl = clampTtlMs(ttlMs, subjectType);
  const entry: UnlockEntry = { privateKey, unlockedAt: now, expiresAt: now + ttl };
  state().entries.set(keyOf(subjectType, subjectId), entry);
  return { expiresAt: new Date(entry.expiresAt).toISOString() };
}

function notifyLocked(subjectType: VaultSubjectType, subjectId: string, reason: string): void {
  for (const cb of state().onLocked) {
    try {
      cb(subjectType, subjectId, reason);
    } catch {
      /* a listener never breaks locking */
    }
  }
}

/** End an unlock now. Returns whether one was active. */
export function lockVault(subjectType: VaultSubjectType, subjectId: string, reason = 'locked by owner'): boolean {
  const existed = state().entries.delete(keyOf(subjectType, subjectId));
  if (existed) notifyLocked(subjectType, subjectId, reason);
  return existed;
}

/** The unlocked private key, or null when locked/expired. Expiry is enforced here. */
export function getUnlockedKey(subjectType: VaultSubjectType, subjectId: string, now: number = Date.now()): CryptoKey | null {
  const k = keyOf(subjectType, subjectId);
  const entry = state().entries.get(k);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    state().entries.delete(k);
    notifyLocked(subjectType, subjectId, 'unlock expired');
    return null;
  }
  return entry.privateKey;
}

export function unlockStatus(
  subjectType: VaultSubjectType,
  subjectId: string,
  now: number = Date.now(),
): { unlocked: boolean; expiresAt: string | null; unlockedAt: string | null } {
  const key = getUnlockedKey(subjectType, subjectId, now);
  if (!key) return { unlocked: false, expiresAt: null, unlockedAt: null };
  const entry = state().entries.get(keyOf(subjectType, subjectId))!;
  return { unlocked: true, expiresAt: new Date(entry.expiresAt).toISOString(), unlockedAt: new Date(entry.unlockedAt).toISOString() };
}

export function isUnlocked(subjectType: VaultSubjectType, subjectId: string, now: number = Date.now()): boolean {
  return getUnlockedKey(subjectType, subjectId, now) !== null;
}

export function onVaultLocked(cb: (subjectType: VaultSubjectType, subjectId: string, reason: string) => void): void {
  state().onLocked.push(cb);
}

/** Test seam: what a process restart does. */
export function resetUnlockStore(): void {
  state().entries.clear();
}
