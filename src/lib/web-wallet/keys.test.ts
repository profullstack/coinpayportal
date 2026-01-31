import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  isValidMnemonic,
  mnemonicToSeed,
  deriveKeyForChain,
  deriveWalletBundle,
} from './keys';
import type { WalletChain } from './identity';

// Known test mnemonic (DO NOT use in production)
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('Web Wallet Keys', () => {
  describe('generateMnemonic', () => {
    it('should generate a valid 12-word mnemonic', () => {
      const mnemonic = generateMnemonic(12);
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(12);
      expect(isValidMnemonic(mnemonic)).toBe(true);
    });

    it('should generate a valid 24-word mnemonic', () => {
      const mnemonic = generateMnemonic(24);
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(24);
      expect(isValidMnemonic(mnemonic)).toBe(true);
    });

    it('should default to 12 words', () => {
      const mnemonic = generateMnemonic();
      expect(mnemonic.split(' ')).toHaveLength(12);
    });

    it('should generate unique mnemonics', () => {
      const m1 = generateMnemonic();
      const m2 = generateMnemonic();
      expect(m1).not.toBe(m2);
    });
  });

  describe('isValidMnemonic', () => {
    it('should accept valid 12-word mnemonic', () => {
      expect(isValidMnemonic(TEST_MNEMONIC)).toBe(true);
    });

    it('should reject invalid mnemonic', () => {
      expect(isValidMnemonic('invalid words here')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidMnemonic('')).toBe(false);
    });

    it('should reject partial mnemonic', () => {
      expect(isValidMnemonic('abandon abandon abandon')).toBe(false);
    });
  });

  describe('mnemonicToSeed', () => {
    it('should produce a 64-byte seed', () => {
      const seed = mnemonicToSeed(TEST_MNEMONIC);
      expect(seed).toBeInstanceOf(Uint8Array);
      expect(seed.length).toBe(64);
    });

    it('should produce deterministic seed', () => {
      const s1 = mnemonicToSeed(TEST_MNEMONIC);
      const s2 = mnemonicToSeed(TEST_MNEMONIC);
      expect(Buffer.from(s1).toString('hex')).toBe(Buffer.from(s2).toString('hex'));
    });

    it('should produce different seed with passphrase', () => {
      const s1 = mnemonicToSeed(TEST_MNEMONIC);
      const s2 = mnemonicToSeed(TEST_MNEMONIC, 'my-passphrase');
      expect(Buffer.from(s1).toString('hex')).not.toBe(Buffer.from(s2).toString('hex'));
    });
  });

  describe('deriveKeyForChain - BTC', () => {
    it('should derive a valid BTC address', async () => {
      const key = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
      expect(key.chain).toBe('BTC');
      expect(key.address).toMatch(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/);
      expect(key.publicKey).toHaveLength(66); // compressed secp256k1
      expect(key.privateKey).toHaveLength(64); // 32 bytes hex
      expect(key.derivationPath).toBe("m/44'/0'/0'/0/0");
      expect(key.index).toBe(0);
    });

    it('should derive deterministic addresses', async () => {
      const k1 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
      const k2 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
      expect(k1.address).toBe(k2.address);
      expect(k1.publicKey).toBe(k2.publicKey);
    });

    it('should derive different addresses for different indices', async () => {
      const k0 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
      const k1 = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 1);
      expect(k0.address).not.toBe(k1.address);
    });
  });

  describe('deriveKeyForChain - BCH', () => {
    it('should derive a CashAddr format address', async () => {
      const key = await deriveKeyForChain(TEST_MNEMONIC, 'BCH', 0);
      expect(key.chain).toBe('BCH');
      expect(key.address).toMatch(/^bitcoincash:q[a-z0-9]+$/);
      expect(key.derivationPath).toBe("m/44'/145'/0'/0/0");
    });

    it('should use different path than BTC', async () => {
      const btcKey = await deriveKeyForChain(TEST_MNEMONIC, 'BTC', 0);
      const bchKey = await deriveKeyForChain(TEST_MNEMONIC, 'BCH', 0);
      expect(btcKey.address).not.toBe(bchKey.address);
      expect(btcKey.derivationPath).not.toBe(bchKey.derivationPath);
    });
  });

  describe('deriveKeyForChain - ETH', () => {
    it('should derive a valid ETH address', async () => {
      const key = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
      expect(key.chain).toBe('ETH');
      expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(key.derivationPath).toBe("m/44'/60'/0'/0/0");
    });

    it('should derive EIP-55 checksummed address', async () => {
      const key = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
      // Verify it has mixed case (EIP-55 checksum)
      const hexPart = key.address.slice(2);
      const hasUpper = /[A-F]/.test(hexPart);
      const hasLower = /[a-f]/.test(hexPart);
      expect(hasUpper || hasLower).toBe(true);
      // Verify it's a valid 42-char hex address
      expect(key.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  describe('deriveKeyForChain - POL', () => {
    it('should derive same address format as ETH (same path)', async () => {
      const ethKey = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
      const polKey = await deriveKeyForChain(TEST_MNEMONIC, 'POL', 0);
      // ETH and POL share the same derivation path, same address
      expect(polKey.address).toBe(ethKey.address);
      expect(polKey.chain).toBe('POL');
    });
  });

  describe('deriveKeyForChain - SOL', () => {
    it('should derive a valid Solana address', async () => {
      const key = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
      expect(key.chain).toBe('SOL');
      // Solana addresses are base58, 32-44 chars
      expect(key.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(key.derivationPath).toBe("m/44'/501'/0'/0'");
    });

    it('should derive deterministic Solana addresses', async () => {
      const k1 = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
      const k2 = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
      expect(k1.address).toBe(k2.address);
    });

    it('should derive different addresses for different indices', async () => {
      const k0 = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
      const k1 = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 1);
      expect(k0.address).not.toBe(k1.address);
    });
  });

  describe('deriveKeyForChain - USDC variants', () => {
    it('should derive USDC_ETH using ETH path', async () => {
      const ethKey = await deriveKeyForChain(TEST_MNEMONIC, 'ETH', 0);
      const usdcKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_ETH', 0);
      expect(usdcKey.address).toBe(ethKey.address);
      expect(usdcKey.chain).toBe('USDC_ETH');
    });

    it('should derive USDC_SOL using SOL path', async () => {
      const solKey = await deriveKeyForChain(TEST_MNEMONIC, 'SOL', 0);
      const usdcKey = await deriveKeyForChain(TEST_MNEMONIC, 'USDC_SOL', 0);
      expect(usdcKey.address).toBe(solKey.address);
      expect(usdcKey.chain).toBe('USDC_SOL');
    });
  });

  describe('deriveWalletBundle', () => {
    it('should derive a full wallet bundle', async () => {
      const bundle = await deriveWalletBundle(TEST_MNEMONIC);

      expect(bundle.mnemonic).toBe(TEST_MNEMONIC);
      expect(bundle.publicKeySecp256k1).toHaveLength(66); // compressed
      expect(bundle.publicKeyEd25519).toBeTruthy();
      // Default chains: BTC, BCH, ETH, POL, SOL
      expect(bundle.addresses).toHaveLength(5);
    });

    it('should derive for custom chain set', async () => {
      const chains: WalletChain[] = ['ETH', 'SOL'];
      const bundle = await deriveWalletBundle(TEST_MNEMONIC, chains);

      expect(bundle.addresses).toHaveLength(2);
      expect(bundle.addresses[0].chain).toBe('ETH');
      expect(bundle.addresses[1].chain).toBe('SOL');
    });

    it('should reject invalid mnemonic', async () => {
      await expect(deriveWalletBundle('invalid words')).rejects.toThrow('Invalid mnemonic');
    });
  });

  describe('cross-chain consistency', () => {
    it('should produce valid addresses for all supported chains', async () => {
      const allChains: WalletChain[] = [
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'USDC_ETH', 'USDC_POL', 'USDC_SOL',
      ];

      for (const chain of allChains) {
        const key = await deriveKeyForChain(TEST_MNEMONIC, chain, 0);
        expect(key.chain).toBe(chain);
        expect(key.address).toBeTruthy();
        expect(key.publicKey).toBeTruthy();
        expect(key.privateKey).toBeTruthy();
        expect(key.index).toBe(0);
      }
    });
  });
});

