/**
 * Migration: Single wallet → Multi wallet registry
 *
 * Reads old coinpay_wallet key, converts to registry format,
 * sets as active wallet, removes old key.
 */

import type { StoredWallet } from './client-crypto';
import type { WalletEntry } from './wallet-registry';
import {
  getWalletRegistry,
  saveWalletRegistry,
  setActiveWalletId,
} from './wallet-registry';

const OLD_KEY = 'coinpay_wallet';

export function needsMigration(): boolean {
  const hasOldFormat = localStorage.getItem(OLD_KEY) !== null;
  const hasNewFormat = Object.keys(getWalletRegistry()).length > 0;
  return hasOldFormat && !hasNewFormat;
}

export function migrateToMultiWallet(): boolean {
  const raw = localStorage.getItem(OLD_KEY);
  if (!raw) return false;

  try {
    const old: StoredWallet = JSON.parse(raw);

    const entry: WalletEntry = {
      id: old.walletId,
      label: 'My Wallet',
      encrypted: old.encrypted,
      createdAt: old.createdAt,
      chains: old.chains,
    };

    const registry = getWalletRegistry();
    registry[entry.id] = entry;
    saveWalletRegistry(registry);
    setActiveWalletId(entry.id);

    // Remove old key
    localStorage.removeItem(OLD_KEY);

    return true;
  } catch (err) {
    console.error('Migration failed:', err);
    return false;
  }
}

export function ensureMigrated(): void {
  if (needsMigration()) {
    migrateToMultiWallet();
  }
}
