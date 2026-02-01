import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptWithPassword,
  decryptWithPassword,
  checkPasswordStrength,
  saveWalletToStorage,
  loadWalletFromStorage,
  removeWalletFromStorage,
  hasStoredWallet,
  type StoredWallet,
  type EncryptedData,
} from './client-crypto';

describe('client-crypto', () => {
  describe('encryptWithPassword / decryptWithPassword', () => {
    it('should encrypt and decrypt a mnemonic round-trip', async () => {
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const password = 'MyStr0ngP@ssword!';

      const encrypted = await encryptWithPassword(mnemonic, password);

      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.salt).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      // Ciphertext should not contain the plaintext
      expect(encrypted.ciphertext).not.toContain(mnemonic);

      const decrypted = await decryptWithPassword(encrypted, password);
      expect(decrypted).toBe(mnemonic);
    });

    it('should return null for wrong password', async () => {
      const mnemonic = 'test phrase here';
      const encrypted = await encryptWithPassword(mnemonic, 'correct-password');

      const result = await decryptWithPassword(encrypted, 'wrong-password');
      expect(result).toBeNull();
    });

    it('should produce different ciphertexts for same input', async () => {
      const mnemonic = 'same input data';
      const password = 'same-password';

      const enc1 = await encryptWithPassword(mnemonic, password);
      const enc2 = await encryptWithPassword(mnemonic, password);

      // Random salt and IV should produce different ciphertext
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.salt).not.toBe(enc2.salt);
      expect(enc1.iv).not.toBe(enc2.iv);

      // Both should decrypt correctly
      const dec1 = await decryptWithPassword(enc1, password);
      const dec2 = await decryptWithPassword(enc2, password);
      expect(dec1).toBe(mnemonic);
      expect(dec2).toBe(mnemonic);
    });

    it('should handle empty string', async () => {
      const encrypted = await encryptWithPassword('', 'password');
      const decrypted = await decryptWithPassword(encrypted, 'password');
      expect(decrypted).toBe('');
    });

    it('should handle unicode content', async () => {
      const content = 'emoji test: 🔐🎉 and CJK: 你好';
      const encrypted = await encryptWithPassword(content, 'pass');
      const decrypted = await decryptWithPassword(encrypted, 'pass');
      expect(decrypted).toBe(content);
    });

    it('should return null for corrupted ciphertext', async () => {
      const encrypted = await encryptWithPassword('data', 'password');
      const corrupted: EncryptedData = {
        ...encrypted,
        ciphertext: 'corrupted-base64-data',
      };

      const result = await decryptWithPassword(corrupted, 'password');
      expect(result).toBeNull();
    });
  });

  describe('checkPasswordStrength', () => {
    it('should score empty password as 0', () => {
      const result = checkPasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.label).toBe('Very Weak');
    });

    it('should score short password as 0', () => {
      const result = checkPasswordStrength('abc');
      expect(result.score).toBe(0);
    });

    it('should score 8+ chars lowercase as 1', () => {
      const result = checkPasswordStrength('abcdefgh');
      expect(result.score).toBe(1);
      expect(result.label).toBe('Weak');
    });

    it('should score 12+ chars mixed case as 3', () => {
      const result = checkPasswordStrength('AbcDefGhIjKl');
      expect(result.score).toBe(3);
      expect(result.label).toBe('Strong');
    });

    it('should score complex password as 4', () => {
      const result = checkPasswordStrength('MyStr0ng!Pass');
      expect(result.score).toBe(4);
      expect(result.label).toBe('Very Strong');
    });

    it('should return a tailwind color class', () => {
      const result = checkPasswordStrength('MyStr0ng!Pass');
      expect(result.color).toMatch(/^bg-/);
    });
  });

  describe('localStorage helpers', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('should report no stored wallet initially', () => {
      expect(hasStoredWallet()).toBe(false);
      expect(loadWalletFromStorage()).toBeNull();
    });

    it('should save and load a wallet', () => {
      const wallet: StoredWallet = {
        walletId: 'test-wallet-id',
        encrypted: {
          ciphertext: 'encrypted-data',
          salt: 'salt-data',
          iv: 'iv-data',
        },
        createdAt: '2026-01-31T00:00:00Z',
        chains: ['BTC', 'ETH', 'SOL'],
      };

      saveWalletToStorage(wallet);

      expect(hasStoredWallet()).toBe(true);

      const loaded = loadWalletFromStorage();
      expect(loaded).not.toBeNull();
      expect(loaded!.walletId).toBe('test-wallet-id');
      expect(loaded!.chains).toEqual(['BTC', 'ETH', 'SOL']);
      expect(loaded!.encrypted.ciphertext).toBe('encrypted-data');
    });

    it('should remove a wallet', () => {
      const wallet: StoredWallet = {
        walletId: 'test-id',
        encrypted: { ciphertext: 'c', salt: 's', iv: 'i' },
        createdAt: '2026-01-31T00:00:00Z',
        chains: ['BTC'],
      };

      saveWalletToStorage(wallet);
      expect(hasStoredWallet()).toBe(true);

      removeWalletFromStorage();
      expect(hasStoredWallet()).toBe(false);
      expect(loadWalletFromStorage()).toBeNull();
    });

    it('should handle corrupted localStorage data', () => {
      localStorage.setItem('coinpay_wallet', 'not-valid-json');
      expect(loadWalletFromStorage()).toBeNull();
    });

    it('should overwrite existing wallet on save', () => {
      const wallet1: StoredWallet = {
        walletId: 'wallet-1',
        encrypted: { ciphertext: 'c1', salt: 's1', iv: 'i1' },
        createdAt: '2026-01-31T00:00:00Z',
        chains: ['BTC'],
      };
      const wallet2: StoredWallet = {
        walletId: 'wallet-2',
        encrypted: { ciphertext: 'c2', salt: 's2', iv: 'i2' },
        createdAt: '2026-01-31T01:00:00Z',
        chains: ['ETH', 'SOL'],
      };

      saveWalletToStorage(wallet1);
      saveWalletToStorage(wallet2);

      const loaded = loadWalletFromStorage();
      expect(loaded!.walletId).toBe('wallet-2');
      expect(loaded!.chains).toEqual(['ETH', 'SOL']);
    });
  });
});
