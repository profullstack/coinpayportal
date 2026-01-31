import { describe, it, expect } from 'vitest';
import {
  validateSecp256k1PublicKey,
  validateEd25519PublicKey,
  validateAddress,
  validateDerivationPath,
  isValidChain,
  buildDerivationPath,
  VALID_CHAINS,
} from './identity';

describe('Web Wallet Identity', () => {
  describe('validateSecp256k1PublicKey', () => {
    it('should accept a valid compressed secp256k1 public key (02 prefix)', () => {
      // 33 bytes = 66 hex chars, starts with 02
      const key = '02' + 'a'.repeat(64);
      // This won't be on the curve, but let's test with a real-ish key
      // Use a known valid compressed public key
      const validKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      expect(validateSecp256k1PublicKey(validKey)).toBe(true);
    });

    it('should accept a valid compressed secp256k1 public key (03 prefix)', () => {
      const validKey = '03674b83e04046e0d2b8288e4fba9dbdd670dbaf464e0be1bc1d4be041bd50efb3';
      // This is a random but potentially invalid point; let's use the generator point with 03
      // Actually let's use a known valid key
      const key = '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      expect(validateSecp256k1PublicKey(key)).toBe(true);
    });

    it('should accept key with 0x prefix', () => {
      const validKey = '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      expect(validateSecp256k1PublicKey(validKey)).toBe(true);
    });

    it('should reject empty string', () => {
      expect(validateSecp256k1PublicKey('')).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(validateSecp256k1PublicKey(null as any)).toBe(false);
      expect(validateSecp256k1PublicKey(undefined as any)).toBe(false);
    });

    it('should reject wrong length key', () => {
      expect(validateSecp256k1PublicKey('02abcd')).toBe(false);
    });

    it('should reject uncompressed key (04 prefix)', () => {
      const uncompressed = '04' + 'a'.repeat(128);
      expect(validateSecp256k1PublicKey(uncompressed)).toBe(false);
    });

    it('should reject key with invalid prefix', () => {
      const badPrefix = '05' + 'a'.repeat(64);
      expect(validateSecp256k1PublicKey(badPrefix)).toBe(false);
    });
  });

  describe('validateEd25519PublicKey', () => {
    it('should accept a valid Solana-style base58 key', () => {
      // Solana public keys are 32 bytes base58 encoded
      // Example: a typical Solana address
      const key = '11111111111111111111111111111111';
      expect(validateEd25519PublicKey(key)).toBe(true);
    });

    it('should reject empty string', () => {
      expect(validateEd25519PublicKey('')).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(validateEd25519PublicKey(null as any)).toBe(false);
      expect(validateEd25519PublicKey(undefined as any)).toBe(false);
    });

    it('should reject too short string', () => {
      expect(validateEd25519PublicKey('abc')).toBe(false);
    });

    it('should reject invalid base58 characters (0, O, I, l)', () => {
      expect(validateEd25519PublicKey('0' + 'a'.repeat(43))).toBe(false);
      expect(validateEd25519PublicKey('O' + 'a'.repeat(43))).toBe(false);
      expect(validateEd25519PublicKey('I' + 'a'.repeat(43))).toBe(false);
      expect(validateEd25519PublicKey('l' + 'a'.repeat(43))).toBe(false);
    });
  });

  describe('validateAddress', () => {
    it('should validate Bitcoin P2PKH addresses (1...)', () => {
      // Standard testnet-like address format
      expect(validateAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'BTC')).toBe(true);
    });

    it('should validate Bitcoin P2SH addresses (3...)', () => {
      expect(validateAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'BTC')).toBe(true);
    });

    it('should validate Bitcoin bech32 addresses (bc1...)', () => {
      expect(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'BTC')).toBe(true);
    });

    it('should validate Ethereum addresses', () => {
      expect(validateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0e', 'ETH')).toBe(true);
    });

    it('should validate Polygon addresses (same format as ETH)', () => {
      expect(validateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0e', 'POL')).toBe(true);
    });

    it('should validate Solana addresses', () => {
      expect(validateAddress('11111111111111111111111111111111', 'SOL')).toBe(true);
    });

    it('should validate BCH CashAddr format', () => {
      expect(validateAddress('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', 'BCH')).toBe(true);
    });

    it('should validate USDC_ETH addresses', () => {
      expect(validateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD0e', 'USDC_ETH')).toBe(true);
    });

    it('should validate USDC_SOL addresses', () => {
      expect(validateAddress('11111111111111111111111111111111', 'USDC_SOL')).toBe(true);
    });

    it('should reject empty address', () => {
      expect(validateAddress('', 'ETH')).toBe(false);
    });

    it('should reject invalid ETH address', () => {
      expect(validateAddress('not-an-address', 'ETH')).toBe(false);
      expect(validateAddress('0x123', 'ETH')).toBe(false);
    });

    it('should reject invalid BTC address', () => {
      expect(validateAddress('not-a-btc-address', 'BTC')).toBe(false);
    });
  });

  describe('validateDerivationPath', () => {
    it('should validate BTC derivation paths', () => {
      expect(validateDerivationPath("m/44'/0'/0'/0/0", 'BTC')).toBe(true);
      expect(validateDerivationPath("m/44'/0'/0'/0/5", 'BTC')).toBe(true);
      expect(validateDerivationPath("m/44'/0'/0'/0/100", 'BTC')).toBe(true);
    });

    it('should validate BCH derivation paths', () => {
      expect(validateDerivationPath("m/44'/145'/0'/0/0", 'BCH')).toBe(true);
    });

    it('should validate ETH derivation paths', () => {
      expect(validateDerivationPath("m/44'/60'/0'/0/0", 'ETH')).toBe(true);
      expect(validateDerivationPath("m/44'/60'/0'/0/42", 'ETH')).toBe(true);
    });

    it('should validate POL derivation paths (same as ETH)', () => {
      expect(validateDerivationPath("m/44'/60'/0'/0/0", 'POL')).toBe(true);
    });

    it('should validate SOL derivation paths', () => {
      expect(validateDerivationPath("m/44'/501'/0'/0'", 'SOL')).toBe(true);
      expect(validateDerivationPath("m/44'/501'/5'/0'", 'SOL')).toBe(true);
    });

    it('should validate USDC_ETH derivation paths', () => {
      expect(validateDerivationPath("m/44'/60'/0'/0/0", 'USDC_ETH')).toBe(true);
    });

    it('should reject invalid paths', () => {
      expect(validateDerivationPath('', 'ETH')).toBe(false);
      expect(validateDerivationPath('m/44/60/0/0/0', 'ETH')).toBe(false);
      expect(validateDerivationPath("m/44'/0'/0'/0/0", 'ETH')).toBe(false); // Wrong coin type
    });

    it('should reject null/undefined', () => {
      expect(validateDerivationPath(null as any, 'ETH')).toBe(false);
      expect(validateDerivationPath(undefined as any, 'ETH')).toBe(false);
    });
  });

  describe('isValidChain', () => {
    it('should accept all valid chains', () => {
      for (const chain of VALID_CHAINS) {
        expect(isValidChain(chain)).toBe(true);
      }
    });

    it('should reject invalid chains', () => {
      expect(isValidChain('DOGE')).toBe(false);
      expect(isValidChain('XRP')).toBe(false);
      expect(isValidChain('')).toBe(false);
      expect(isValidChain('eth')).toBe(false); // case sensitive
    });
  });

  describe('buildDerivationPath', () => {
    it('should build BTC path', () => {
      expect(buildDerivationPath('BTC', 0)).toBe("m/44'/0'/0'/0/0");
      expect(buildDerivationPath('BTC', 5)).toBe("m/44'/0'/0'/0/5");
    });

    it('should build BCH path', () => {
      expect(buildDerivationPath('BCH', 0)).toBe("m/44'/145'/0'/0/0");
    });

    it('should build ETH path', () => {
      expect(buildDerivationPath('ETH', 0)).toBe("m/44'/60'/0'/0/0");
      expect(buildDerivationPath('ETH', 1)).toBe("m/44'/60'/0'/0/1");
    });

    it('should build POL path (same as ETH)', () => {
      expect(buildDerivationPath('POL', 0)).toBe("m/44'/60'/0'/0/0");
    });

    it('should build SOL path', () => {
      expect(buildDerivationPath('SOL', 0)).toBe("m/44'/501'/0'/0'");
      expect(buildDerivationPath('SOL', 3)).toBe("m/44'/501'/3'/0'");
    });

    it('should build USDC paths correctly', () => {
      expect(buildDerivationPath('USDC_ETH', 0)).toBe("m/44'/60'/0'/0/0");
      expect(buildDerivationPath('USDC_POL', 0)).toBe("m/44'/60'/0'/0/0");
      expect(buildDerivationPath('USDC_SOL', 0)).toBe("m/44'/501'/0'/0'");
    });

    it('should throw for unsupported chain', () => {
      expect(() => buildDerivationPath('DOGE' as any, 0)).toThrow('Unsupported chain');
    });
  });
});
