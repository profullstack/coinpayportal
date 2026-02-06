import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletSDKError } from './errors';
import { encryptSeedPhrase, decryptSeedPhrase } from './backup';

// The Wallet class constructor is private and factories make API calls,
// so we test the backup methods by:
// 1. Testing the static decryptBackup independently (it's a thin wrapper)
// 2. Testing that exportEncryptedBackup throws READ_ONLY when no mnemonic
// 3. Round-trip testing using the underlying backup module functions

// We need to import Wallet to test its static method and instance behavior
// We'll mock the API client to avoid network calls
vi.mock('./client', () => ({
  WalletAPIClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({
      wallet_id: 'test-wallet-id',
      created_at: new Date().toISOString(),
      addresses: [],
    }),
    setSignatureAuth: vi.fn(),
    setJWTToken: vi.fn(),
    clearAuth: vi.fn(),
  })),
  hexToUint8Array: vi.fn((hex: string) => new Uint8Array(hex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || [])),
  uint8ArrayToHex: vi.fn((arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')),
}));

// Mock the key derivation modules to avoid heavy crypto during tests
vi.mock('../web-wallet/keys', () => ({
  generateMnemonic: vi.fn().mockReturnValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  ),
  isValidMnemonic: vi.fn().mockReturnValue(true),
  deriveWalletBundle: vi.fn().mockResolvedValue({
    publicKeySecp256k1: 'mock-pub-key-secp',
    publicKeyEd25519: 'mock-pub-key-ed',
    privateKeySecp256k1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    addresses: [],
  }),
  deriveKeyForChain: vi.fn(),
}));

vi.mock('../web-wallet/signing', () => ({
  signTransaction: vi.fn(),
}));

vi.mock('../web-wallet/identity', () => ({
  buildDerivationPath: vi.fn().mockReturnValue("m/44'/60'/0'/0/0"),
}));

import { Wallet } from './wallet';

describe('Wallet backup methods', () => {
  const testMnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const testPassword = 'Str0ng!P@ssword';

  describe('Wallet.decryptBackup (static)', () => {
    it('should decrypt data encrypted by encryptSeedPhrase', async () => {
      const { data } = await encryptSeedPhrase(testMnemonic, testPassword, 'test-wallet');
      const decrypted = await Wallet.decryptBackup(data, testPassword);

      expect(decrypted).toBe(testMnemonic);
    });

    it('should return null for wrong password', async () => {
      const { data } = await encryptSeedPhrase(testMnemonic, testPassword, 'test-wallet');
      const decrypted = await Wallet.decryptBackup(data, 'wrong-password');

      expect(decrypted).toBeNull();
    });

    it('should return null for garbage data', async () => {
      const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);
      const decrypted = await Wallet.decryptBackup(garbage, testPassword);

      expect(decrypted).toBeNull();
    });
  });

  describe('wallet.exportEncryptedBackup (instance)', () => {
    it('should throw WalletSDKError with READ_ONLY code for read-only wallets', async () => {
      // fromWalletId creates a read-only wallet (no mnemonic)
      const readOnlyWallet = Wallet.fromWalletId('test-id', {
        baseUrl: 'https://test.api.com',
        apiKey: 'test-key',
      });

      await expect(readOnlyWallet.exportEncryptedBackup(testPassword))
        .rejects.toThrow(WalletSDKError);

      try {
        await readOnlyWallet.exportEncryptedBackup(testPassword);
      } catch (err) {
        expect(err).toBeInstanceOf(WalletSDKError);
        expect((err as WalletSDKError).code).toBe('READ_ONLY');
      }
    });

    it('should produce encrypted data when wallet has mnemonic (via create)', async () => {
      const wallet = await Wallet.create({
        baseUrl: 'https://test.api.com',
        apiKey: 'test-key',
        chains: ['BTC'],
      });

      const backup = await wallet.exportEncryptedBackup(testPassword);

      expect(backup.data).toBeInstanceOf(Uint8Array);
      expect(backup.data.length).toBeGreaterThan(0);
      expect(backup.filename).toMatch(/^wallet_coinpayportal_.*_seedphrase\.txt\.gpg$/);
      expect(backup.walletId).toBeTruthy();
    });

    it('should produce data that Wallet.decryptBackup can decrypt', async () => {
      const wallet = await Wallet.create({
        baseUrl: 'https://test.api.com',
        apiKey: 'test-key',
        chains: ['BTC'],
      });

      const backup = await wallet.exportEncryptedBackup(testPassword);
      const decrypted = await Wallet.decryptBackup(backup.data, testPassword);

      // The mock generates the known test mnemonic
      expect(decrypted).toBe(testMnemonic);
    });

    it('should not decrypt with a wrong password', async () => {
      const wallet = await Wallet.create({
        baseUrl: 'https://test.api.com',
        apiKey: 'test-key',
        chains: ['BTC'],
      });

      const backup = await wallet.exportEncryptedBackup(testPassword);
      const decrypted = await Wallet.decryptBackup(backup.data, 'wrong-pw');

      expect(decrypted).toBeNull();
    });
  });
});
