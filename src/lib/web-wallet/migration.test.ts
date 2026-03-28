import { describe, it, expect, beforeEach } from 'vitest';
import type { StoredWallet, EncryptedData } from './client-crypto';
import {
  needsMigration,
  migrateToMultiWallet,
  ensureMigrated,
} from './migration';
import {
  getWalletRegistry,
  getActiveWalletId,
  getAllWallets,
  getWalletCount,
  addWalletToRegistry,
} from './wallet-registry';

const OLD_KEY = 'coinpay_wallet';

function makeOldWallet(walletId = 'old-wallet-uuid'): StoredWallet {
  const encrypted: EncryptedData = {
    ciphertext: 'encrypted-seed-data',
    salt: 'random-salt',
    iv: 'random-iv',
  };
  return {
    walletId,
    encrypted,
    createdAt: '2026-01-15T12:00:00Z',
    chains: ['BTC', 'ETH', 'SOL', 'LN'],
  };
}

describe('migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('needsMigration', () => {
    it('should return false when no old wallet exists', () => {
      expect(needsMigration()).toBe(false);
    });

    it('should return true when old format exists and no registry', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify(makeOldWallet()));
      expect(needsMigration()).toBe(true);
    });

    it('should return false when old format exists but registry already populated', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify(makeOldWallet()));
      addWalletToRegistry({
        id: 'already-migrated',
        label: 'Existing',
        encrypted: { ciphertext: 'x', salt: 'y', iv: 'z' },
        createdAt: '2026-03-01T00:00:00Z',
        chains: ['BTC'],
      });
      expect(needsMigration()).toBe(false);
    });

    it('should return false when only registry exists (no old format)', () => {
      addWalletToRegistry({
        id: 'new-wallet',
        label: 'New',
        encrypted: { ciphertext: 'x', salt: 'y', iv: 'z' },
        createdAt: '2026-03-01T00:00:00Z',
        chains: ['BTC'],
      });
      expect(needsMigration()).toBe(false);
    });
  });

  describe('migrateToMultiWallet', () => {
    it('should return false when no old wallet exists', () => {
      expect(migrateToMultiWallet()).toBe(false);
    });

    it('should migrate old wallet to registry', () => {
      const oldWallet = makeOldWallet('test-wallet-id');
      localStorage.setItem(OLD_KEY, JSON.stringify(oldWallet));

      const result = migrateToMultiWallet();
      expect(result).toBe(true);

      // Registry should have the wallet
      const registry = getWalletRegistry();
      expect(registry['test-wallet-id']).toBeDefined();
      expect(registry['test-wallet-id'].label).toBe('My Wallet');
      expect(registry['test-wallet-id'].encrypted).toEqual(oldWallet.encrypted);
      expect(registry['test-wallet-id'].chains).toEqual(oldWallet.chains);
      expect(registry['test-wallet-id'].createdAt).toBe(oldWallet.createdAt);
    });

    it('should set the migrated wallet as active', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify(makeOldWallet('active-id')));
      migrateToMultiWallet();

      expect(getActiveWalletId()).toBe('active-id');
    });

    it('should remove the old localStorage key', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify(makeOldWallet()));
      migrateToMultiWallet();

      expect(localStorage.getItem(OLD_KEY)).toBeNull();
    });

    it('should preserve encrypted data exactly', () => {
      const oldWallet = makeOldWallet();
      localStorage.setItem(OLD_KEY, JSON.stringify(oldWallet));
      migrateToMultiWallet();

      const entry = getWalletRegistry()[oldWallet.walletId];
      expect(entry.encrypted.ciphertext).toBe(oldWallet.encrypted.ciphertext);
      expect(entry.encrypted.salt).toBe(oldWallet.encrypted.salt);
      expect(entry.encrypted.iv).toBe(oldWallet.encrypted.iv);
    });

    it('should handle corrupted old data gracefully', () => {
      localStorage.setItem(OLD_KEY, '{invalid json!!!');
      const result = migrateToMultiWallet();
      expect(result).toBe(false);
      expect(getWalletCount()).toBe(0);
    });
  });

  describe('ensureMigrated', () => {
    it('should migrate when needed', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify(makeOldWallet('ensure-id')));
      ensureMigrated();

      expect(getWalletCount()).toBe(1);
      expect(getActiveWalletId()).toBe('ensure-id');
      expect(localStorage.getItem(OLD_KEY)).toBeNull();
    });

    it('should do nothing when already migrated', () => {
      addWalletToRegistry({
        id: 'existing',
        label: 'Existing',
        encrypted: { ciphertext: 'x', salt: 'y', iv: 'z' },
        createdAt: '2026-03-01T00:00:00Z',
        chains: ['BTC'],
      });

      // Also put old format (edge case — should skip since registry exists)
      localStorage.setItem(OLD_KEY, JSON.stringify(makeOldWallet()));
      ensureMigrated();

      // Should NOT have migrated the old wallet
      expect(getWalletCount()).toBe(1);
      expect(getWalletRegistry()['existing']).toBeDefined();
    });

    it('should do nothing when no wallets exist at all', () => {
      ensureMigrated();
      expect(getWalletCount()).toBe(0);
      expect(getActiveWalletId()).toBeNull();
    });

    it('should be idempotent — running twice does not duplicate', () => {
      localStorage.setItem(OLD_KEY, JSON.stringify(makeOldWallet('idem-id')));
      ensureMigrated();
      ensureMigrated();

      expect(getWalletCount()).toBe(1);
      const wallets = getAllWallets();
      expect(wallets[0].id).toBe('idem-id');
    });
  });
});
