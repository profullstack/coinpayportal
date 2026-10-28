import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampTtlMs,
  DEFAULT_MERCHANT_TTL_MS,
  DEFAULT_OPERATOR_TTL_MS,
  getUnlockedKey,
  isUnlocked,
  lockVault,
  MAX_UNLOCK_TTL_MS,
  onVaultLocked,
  putUnlock,
  resetUnlockStore,
  unlockStatus,
} from './unlock-store';

const fakeKey = {} as CryptoKey;

afterEach(() => resetUnlockStore());

describe('unlock store', () => {
  it('holds an unlock until its TTL, then forgets it', () => {
    const t0 = 1_000_000;
    putUnlock('merchant', 'm1', fakeKey, 3600_000, t0);
    expect(isUnlocked('merchant', 'm1', t0 + 1000)).toBe(true);
    expect(getUnlockedKey('merchant', 'm1', t0 + 3600_000)).toBeNull();
    expect(isUnlocked('merchant', 'm1', t0 + 1000)).toBe(false); // gone for good
  });

  it('caps the TTL at 7 days and applies per-subject defaults', () => {
    expect(clampTtlMs(30 * 24 * 3600_000, 'merchant')).toBe(MAX_UNLOCK_TTL_MS);
    expect(clampTtlMs(null, 'merchant')).toBe(DEFAULT_MERCHANT_TTL_MS);
    expect(clampTtlMs(undefined, 'operator')).toBe(DEFAULT_OPERATOR_TTL_MS);
    expect(clampTtlMs(1, 'merchant')).toBe(60_000);
    const { expiresAt } = putUnlock('merchant', 'm1', fakeKey, 365 * 24 * 3600_000, 0);
    expect(Date.parse(expiresAt)).toBe(MAX_UNLOCK_TTL_MS);
  });

  it('lock ends it now and notifies once', () => {
    const cb = vi.fn();
    onVaultLocked(cb);
    putUnlock('merchant', 'm1', fakeKey, 3600_000);
    expect(lockVault('merchant', 'm1')).toBe(true);
    expect(isUnlocked('merchant', 'm1')).toBe(false);
    expect(lockVault('merchant', 'm1')).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a restart drops every unlock', () => {
    putUnlock('merchant', 'm1', fakeKey, 3600_000);
    putUnlock('operator', 'coinpay', fakeKey, 3600_000);
    resetUnlockStore();
    expect(unlockStatus('merchant', 'm1').unlocked).toBe(false);
    expect(unlockStatus('operator', 'coinpay').unlocked).toBe(false);
  });

  it('subjects are separate', () => {
    putUnlock('merchant', 'm1', fakeKey, 3600_000);
    expect(isUnlocked('merchant', 'm2')).toBe(false);
    expect(isUnlocked('operator', 'm1')).toBe(false);
  });
});
