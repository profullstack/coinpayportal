import { describe, it, expect } from 'vitest';
import { encryptSeedPhrase, decryptSeedPhrase } from './backup';

describe('wallet-sdk/backup', () => {
  const testMnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const testPassword = 'Str0ng!P@ssword';
  const testWalletId = 'wid-abc-123';

  describe('encryptSeedPhrase', () => {
    it('should return a non-empty Uint8Array in data', async () => {
      const result = await encryptSeedPhrase(testMnemonic, testPassword, testWalletId);

      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should return the correct filename format', async () => {
      const result = await encryptSeedPhrase(testMnemonic, testPassword, testWalletId);

      expect(result.filename).toBe(`wallet_${testWalletId}_seedphrase.txt.gpg`);
    });

    it('should return the walletId in the result', async () => {
      const result = await encryptSeedPhrase(testMnemonic, testPassword, testWalletId);

      expect(result.walletId).toBe(testWalletId);
    });

    it('should produce different filenames for different wallet IDs', async () => {
      const result1 = await encryptSeedPhrase(testMnemonic, testPassword, 'wallet-1');
      const result2 = await encryptSeedPhrase(testMnemonic, testPassword, 'wallet-2');

      expect(result1.filename).not.toBe(result2.filename);
      expect(result1.filename).toBe('wallet_wallet-1_seedphrase.txt.gpg');
      expect(result2.filename).toBe('wallet_wallet-2_seedphrase.txt.gpg');
    });
  });

  describe('round-trip: encrypt → decrypt', () => {
    it('should decrypt to the original mnemonic', async () => {
      const { data } = await encryptSeedPhrase(testMnemonic, testPassword, testWalletId);
      const decrypted = await decryptSeedPhrase(data, testPassword);

      expect(decrypted).toBe(testMnemonic);
    });

    it('should return null for a wrong password', async () => {
      const { data } = await encryptSeedPhrase(testMnemonic, testPassword, testWalletId);
      const decrypted = await decryptSeedPhrase(data, 'wrong-password');

      expect(decrypted).toBeNull();
    });

    it('should handle an empty mnemonic', async () => {
      const { data } = await encryptSeedPhrase('', testPassword, testWalletId);
      const decrypted = await decryptSeedPhrase(data, testPassword);

      // Empty mnemonic → after stripping comments and blank lines, returns null
      // (since there are no non-comment non-empty lines)
      expect(decrypted).toBeNull();
    });

    it('should work with special characters in the password', async () => {
      const specialPassword = '∂ƒ©˙∆˚¬…æ!@#$%^&*()_+{}|:"<>?';
      const { data } = await encryptSeedPhrase(testMnemonic, specialPassword, testWalletId);
      const decrypted = await decryptSeedPhrase(data, specialPassword);

      expect(decrypted).toBe(testMnemonic);
    });

    it('should work with unicode characters in the password', async () => {
      const unicodePassword = '密码🔐пароль';
      const { data } = await encryptSeedPhrase(testMnemonic, unicodePassword, testWalletId);
      const decrypted = await decryptSeedPhrase(data, unicodePassword);

      expect(decrypted).toBe(testMnemonic);
    });

    it('should work with a very long mnemonic (24 words)', async () => {
      const longMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
      const { data } = await encryptSeedPhrase(longMnemonic, testPassword, testWalletId);
      const decrypted = await decryptSeedPhrase(data, testPassword);

      expect(decrypted).toBe(longMnemonic);
    });
  });

  describe('decryptSeedPhrase edge cases', () => {
    it('should return null for garbage data', async () => {
      const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const result = await decryptSeedPhrase(garbage, testPassword);

      expect(result).toBeNull();
    });

    it('should return null for an empty Uint8Array', async () => {
      const empty = new Uint8Array(0);
      const result = await decryptSeedPhrase(empty, testPassword);

      expect(result).toBeNull();
    });
  });
});
