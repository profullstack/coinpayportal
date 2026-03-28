import { describe, it, expect, beforeEach } from 'vitest';
import type { EncryptedData } from './client-crypto';
import {
  type WalletEntry,
  getWalletRegistry,
  saveWalletRegistry,
  getActiveWalletId,
  setActiveWalletId,
  getActiveWallet,
  addWalletToRegistry,
  removeWalletFromRegistry,
  updateWalletInRegistry,
  getWalletCount,
  hasAnyWallet,
  getAllWallets,
} from './wallet-registry';

function makeFakeEncrypted(): EncryptedData {
  return {
    ciphertext: 'fakeCiphertext' + Math.random(),
    salt: 'fakeSalt' + Math.random(),
    iv: 'fakeIv' + Math.random(),
  };
}

function makeEntry(id: string, label: string, createdAt?: string): WalletEntry {
  return {
    id,
    label,
    encrypted: makeFakeEncrypted(),
    createdAt: createdAt || new Date().toISOString(),
    chains: ['BTC', 'ETH', 'SOL'],
  };
}

describe('wallet-registry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getWalletRegistry / saveWalletRegistry', () => {
    it('should return empty object when no registry exists', () => {
      expect(getWalletRegistry()).toEqual({});
    });

    it('should save and load a registry', () => {
      const entry = makeEntry('wallet-1', 'Main');
      const registry = { 'wallet-1': entry };
      saveWalletRegistry(registry);

      const loaded = getWalletRegistry();
      expect(loaded['wallet-1']).toBeDefined();
      expect(loaded['wallet-1'].label).toBe('Main');
      expect(loaded['wallet-1'].id).toBe('wallet-1');
    });

    it('should return empty object on corrupted JSON', () => {
      localStorage.setItem('coinpay_wallets', '{bad json');
      expect(getWalletRegistry()).toEqual({});
    });
  });

  describe('getActiveWalletId / setActiveWalletId', () => {
    it('should return null when no active wallet is set', () => {
      expect(getActiveWalletId()).toBeNull();
    });

    it('should set and get the active wallet ID', () => {
      setActiveWalletId('wallet-abc');
      expect(getActiveWalletId()).toBe('wallet-abc');
    });
  });

  describe('getActiveWallet', () => {
    it('should return null when no active ID is set', () => {
      expect(getActiveWallet()).toBeNull();
    });

    it('should return null when active ID does not match any entry', () => {
      setActiveWalletId('nonexistent');
      expect(getActiveWallet()).toBeNull();
    });

    it('should return the active wallet entry', () => {
      const entry = makeEntry('wallet-1', 'Main');
      saveWalletRegistry({ 'wallet-1': entry });
      setActiveWalletId('wallet-1');

      const active = getActiveWallet();
      expect(active).toBeDefined();
      expect(active!.id).toBe('wallet-1');
      expect(active!.label).toBe('Main');
    });
  });

  describe('addWalletToRegistry', () => {
    it('should add a wallet to an empty registry', () => {
      const entry = makeEntry('wallet-1', 'First');
      addWalletToRegistry(entry);

      const registry = getWalletRegistry();
      expect(Object.keys(registry)).toHaveLength(1);
      expect(registry['wallet-1'].label).toBe('First');
    });

    it('should add multiple wallets', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'First'));
      addWalletToRegistry(makeEntry('wallet-2', 'Second'));

      expect(getWalletCount()).toBe(2);
    });

    it('should overwrite an existing wallet with same ID', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'Original'));
      addWalletToRegistry(makeEntry('wallet-1', 'Updated'));

      const registry = getWalletRegistry();
      expect(Object.keys(registry)).toHaveLength(1);
      expect(registry['wallet-1'].label).toBe('Updated');
    });

    it('should throw when max wallets reached', () => {
      for (let i = 0; i < 10; i++) {
        addWalletToRegistry(makeEntry(`wallet-${i}`, `Wallet ${i}`));
      }
      expect(getWalletCount()).toBe(10);

      expect(() => {
        addWalletToRegistry(makeEntry('wallet-11', 'One Too Many'));
      }).toThrow(/Maximum of 10 wallets/);
    });

    it('should allow updating existing wallet even at max count', () => {
      for (let i = 0; i < 10; i++) {
        addWalletToRegistry(makeEntry(`wallet-${i}`, `Wallet ${i}`));
      }

      // Updating existing should not throw
      expect(() => {
        addWalletToRegistry(makeEntry('wallet-0', 'Updated'));
      }).not.toThrow();
      expect(getWalletRegistry()['wallet-0'].label).toBe('Updated');
    });
  });

  describe('removeWalletFromRegistry', () => {
    it('should remove a wallet', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'First'));
      addWalletToRegistry(makeEntry('wallet-2', 'Second'));
      expect(getWalletCount()).toBe(2);

      removeWalletFromRegistry('wallet-1');
      expect(getWalletCount()).toBe(1);
      expect(getWalletRegistry()['wallet-1']).toBeUndefined();
      expect(getWalletRegistry()['wallet-2']).toBeDefined();
    });

    it('should switch active wallet when active is deleted', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'First'));
      addWalletToRegistry(makeEntry('wallet-2', 'Second'));
      setActiveWalletId('wallet-1');

      removeWalletFromRegistry('wallet-1');

      // Should auto-switch to remaining wallet
      expect(getActiveWalletId()).toBe('wallet-2');
    });

    it('should clear active wallet when last wallet is deleted', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'Only'));
      setActiveWalletId('wallet-1');

      removeWalletFromRegistry('wallet-1');

      expect(getActiveWalletId()).toBeNull();
      expect(getWalletCount()).toBe(0);
    });

    it('should not change active wallet when non-active is deleted', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'First'));
      addWalletToRegistry(makeEntry('wallet-2', 'Second'));
      setActiveWalletId('wallet-1');

      removeWalletFromRegistry('wallet-2');

      expect(getActiveWalletId()).toBe('wallet-1');
    });

    it('should handle removing nonexistent wallet gracefully', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'First'));
      removeWalletFromRegistry('nonexistent');
      expect(getWalletCount()).toBe(1);
    });
  });

  describe('updateWalletInRegistry', () => {
    it('should update a wallet label', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'Original'));
      updateWalletInRegistry('wallet-1', { label: 'Renamed' });

      expect(getWalletRegistry()['wallet-1'].label).toBe('Renamed');
    });

    it('should update wallet chains', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'Main'));
      updateWalletInRegistry('wallet-1', { chains: ['BTC', 'ETH'] });

      expect(getWalletRegistry()['wallet-1'].chains).toEqual(['BTC', 'ETH']);
    });

    it('should not create entry for nonexistent wallet', () => {
      updateWalletInRegistry('nonexistent', { label: 'Ghost' });
      expect(getWalletCount()).toBe(0);
    });

    it('should preserve other fields when updating', () => {
      const entry = makeEntry('wallet-1', 'Main');
      addWalletToRegistry(entry);
      updateWalletInRegistry('wallet-1', { label: 'Updated' });

      const updated = getWalletRegistry()['wallet-1'];
      expect(updated.label).toBe('Updated');
      expect(updated.encrypted).toEqual(entry.encrypted);
      expect(updated.chains).toEqual(entry.chains);
      expect(updated.createdAt).toBe(entry.createdAt);
    });
  });

  describe('getWalletCount', () => {
    it('should return 0 for empty registry', () => {
      expect(getWalletCount()).toBe(0);
    });

    it('should return correct count', () => {
      addWalletToRegistry(makeEntry('w-1', 'A'));
      addWalletToRegistry(makeEntry('w-2', 'B'));
      addWalletToRegistry(makeEntry('w-3', 'C'));
      expect(getWalletCount()).toBe(3);
    });
  });

  describe('hasAnyWallet', () => {
    it('should return false when no wallets exist', () => {
      expect(hasAnyWallet()).toBe(false);
    });

    it('should return true when registry has wallets', () => {
      addWalletToRegistry(makeEntry('wallet-1', 'Main'));
      expect(hasAnyWallet()).toBe(true);
    });

    it('should return true when old format exists (pre-migration)', () => {
      // Simulate old single-wallet format
      localStorage.setItem(
        'coinpay_wallet',
        JSON.stringify({ walletId: 'old', encrypted: {}, createdAt: '', chains: [] })
      );
      expect(hasAnyWallet()).toBe(true);
    });
  });

  describe('getAllWallets', () => {
    it('should return empty array for empty registry', () => {
      expect(getAllWallets()).toEqual([]);
    });

    it('should return all wallets sorted by creation date', () => {
      addWalletToRegistry(
        makeEntry('w-2', 'Second', '2026-03-20T00:00:00Z')
      );
      addWalletToRegistry(
        makeEntry('w-1', 'First', '2026-03-10T00:00:00Z')
      );
      addWalletToRegistry(
        makeEntry('w-3', 'Third', '2026-03-25T00:00:00Z')
      );

      const wallets = getAllWallets();
      expect(wallets).toHaveLength(3);
      expect(wallets[0].id).toBe('w-1');
      expect(wallets[1].id).toBe('w-2');
      expect(wallets[2].id).toBe('w-3');
    });
  });
});
