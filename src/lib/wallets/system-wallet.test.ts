/**
 * System Wallet Tests
 *
 * Tests for HD wallet derivation, mnemonic handling, and commission wallet fallbacks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  deriveSystemPaymentAddress,
  calculateSplit,
  generateSystemMnemonic,
  COMMISSION_RATE,
  type SystemBlockchain,
} from './system-wallet';

// Test mnemonic (DO NOT USE IN PRODUCTION)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('System Wallet', () => {
  describe('generateSystemMnemonic', () => {
    it('should generate a valid 24-word mnemonic', () => {
      const mnemonic = generateSystemMnemonic();
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(24);
    });

    it('should generate unique mnemonics each time', () => {
      const mnemonic1 = generateSystemMnemonic();
      const mnemonic2 = generateSystemMnemonic();
      expect(mnemonic1).not.toBe(mnemonic2);
    });
  });

  describe('calculateSplit', () => {
    it('should calculate correct commission at 0.5%', () => {
      const { commission, merchant } = calculateSplit(100);
      expect(commission).toBe(0.5);
      expect(merchant).toBe(99.5);
    });

    it('should handle small amounts', () => {
      const { commission, merchant } = calculateSplit(1);
      expect(commission).toBe(0.005);
      expect(merchant).toBe(0.995);
    });

    it('should handle large amounts', () => {
      const { commission, merchant } = calculateSplit(1000000);
      expect(commission).toBe(5000);
      expect(merchant).toBe(995000);
    });

    it('should have commission + merchant equal total', () => {
      const total = 123.456;
      const { commission, merchant } = calculateSplit(total);
      expect(commission + merchant).toBeCloseTo(total, 10);
    });
  });

  describe('COMMISSION_RATE', () => {
    it('should be 0.5%', () => {
      expect(COMMISSION_RATE).toBe(0.005);
    });
  });

  describe('deriveSystemPaymentAddress', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment
      process.env = { ...originalEnv };
      // Set test mnemonics
      process.env.SYSTEM_MNEMONIC_BTC = TEST_MNEMONIC;
      process.env.SYSTEM_MNEMONIC_BCH = TEST_MNEMONIC;
      process.env.SYSTEM_MNEMONIC_ETH = TEST_MNEMONIC;
      process.env.SYSTEM_MNEMONIC_SOL = TEST_MNEMONIC;
      process.env.SYSTEM_MNEMONIC_DOGE = TEST_MNEMONIC;
      process.env.SYSTEM_MNEMONIC_XRP = TEST_MNEMONIC;
      process.env.SYSTEM_MNEMONIC_ADA = TEST_MNEMONIC;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    describe('BTC derivation', () => {
      it('should derive valid BTC address', async () => {
        const result = await deriveSystemPaymentAddress('BTC', 0);
        expect(result.address).toMatch(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/);
        expect(result.cryptocurrency).toBe('BTC');
        expect(result.index).toBe(0);
        expect(result.derivationPath).toBe("m/44'/0'/0'/0/0");
        expect(result.privateKey).toBeDefined();
      });

      it('should derive different addresses for different indexes', async () => {
        const result0 = await deriveSystemPaymentAddress('BTC', 0);
        const result1 = await deriveSystemPaymentAddress('BTC', 1);
        expect(result0.address).not.toBe(result1.address);
      });

      it('should derive same address for same index', async () => {
        const result1 = await deriveSystemPaymentAddress('BTC', 5);
        const result2 = await deriveSystemPaymentAddress('BTC', 5);
        expect(result1.address).toBe(result2.address);
      });
    });

    describe('BCH derivation', () => {
      it('should derive valid BCH CashAddr address', async () => {
        const result = await deriveSystemPaymentAddress('BCH', 0);
        expect(result.address).toMatch(/^bitcoincash:q[a-z0-9]{41}$/);
        expect(result.cryptocurrency).toBe('BCH');
        expect(result.derivationPath).toBe("m/44'/145'/0'/0/0");
      });

      it('should derive different addresses for different indexes', async () => {
        const result0 = await deriveSystemPaymentAddress('BCH', 0);
        const result1 = await deriveSystemPaymentAddress('BCH', 1);
        expect(result0.address).not.toBe(result1.address);
      });
    });

    describe('ETH derivation', () => {
      it('should derive valid ETH address', async () => {
        const result = await deriveSystemPaymentAddress('ETH', 0);
        expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.cryptocurrency).toBe('ETH');
        expect(result.derivationPath).toBe("m/44'/60'/0'/0/0");
      });

      it('should derive different addresses for different indexes', async () => {
        const result0 = await deriveSystemPaymentAddress('ETH', 0);
        const result1 = await deriveSystemPaymentAddress('ETH', 1);
        expect(result0.address).not.toBe(result1.address);
      });
    });

    describe('EVM token fallback (POL, BNB, USDT, USDC)', () => {
      it('should derive POL address using ETH mnemonic', async () => {
        // Remove POL-specific mnemonic to test fallback
        delete process.env.SYSTEM_MNEMONIC_POL;
        
        const ethResult = await deriveSystemPaymentAddress('ETH', 0);
        const polResult = await deriveSystemPaymentAddress('POL', 0);
        
        // Should use same mnemonic, so same address
        expect(polResult.address).toBe(ethResult.address);
        expect(polResult.cryptocurrency).toBe('POL');
      });

      it('should derive BNB address using ETH mnemonic', async () => {
        delete process.env.SYSTEM_MNEMONIC_BNB;
        
        const ethResult = await deriveSystemPaymentAddress('ETH', 0);
        const bnbResult = await deriveSystemPaymentAddress('BNB', 0);
        
        expect(bnbResult.address).toBe(ethResult.address);
        expect(bnbResult.cryptocurrency).toBe('BNB');
      });

      it('should derive USDT address using ETH mnemonic', async () => {
        delete process.env.SYSTEM_MNEMONIC_USDT;
        
        const ethResult = await deriveSystemPaymentAddress('ETH', 0);
        const usdtResult = await deriveSystemPaymentAddress('USDT', 0);
        
        expect(usdtResult.address).toBe(ethResult.address);
        expect(usdtResult.cryptocurrency).toBe('USDT');
      });

      it('should derive USDC address using ETH mnemonic', async () => {
        delete process.env.SYSTEM_MNEMONIC_USDC;
        
        const ethResult = await deriveSystemPaymentAddress('ETH', 0);
        const usdcResult = await deriveSystemPaymentAddress('USDC', 0);
        
        expect(usdcResult.address).toBe(ethResult.address);
        expect(usdcResult.cryptocurrency).toBe('USDC');
      });

      it('should use specific mnemonic if provided for EVM token', async () => {
        // Set a different mnemonic for POL
        const differentMnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
        process.env.SYSTEM_MNEMONIC_POL = differentMnemonic;
        
        const ethResult = await deriveSystemPaymentAddress('ETH', 0);
        const polResult = await deriveSystemPaymentAddress('POL', 0);
        
        // Should be different because different mnemonic
        expect(polResult.address).not.toBe(ethResult.address);
      });
    });

    describe('SOL derivation', () => {
      it('should derive valid SOL address', async () => {
        const result = await deriveSystemPaymentAddress('SOL', 0);
        // Solana addresses are base58 encoded, 32-44 characters
        expect(result.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
        expect(result.cryptocurrency).toBe('SOL');
        expect(result.derivationPath).toBe("m/44'/501'/0'/0'");
      });

      it('should derive different addresses for different indexes', async () => {
        const result0 = await deriveSystemPaymentAddress('SOL', 0);
        const result1 = await deriveSystemPaymentAddress('SOL', 1);
        expect(result0.address).not.toBe(result1.address);
      });
    });

    describe('DOGE derivation', () => {
      it('should derive valid DOGE address', async () => {
        const result = await deriveSystemPaymentAddress('DOGE', 0);
        // DOGE addresses start with D
        expect(result.address).toMatch(/^D[a-km-zA-HJ-NP-Z1-9]{25,34}$/);
        expect(result.cryptocurrency).toBe('DOGE');
        expect(result.derivationPath).toBe("m/44'/3'/0'/0/0");
      });

      it('should derive different addresses for different indexes', async () => {
        const result0 = await deriveSystemPaymentAddress('DOGE', 0);
        const result1 = await deriveSystemPaymentAddress('DOGE', 1);
        expect(result0.address).not.toBe(result1.address);
      });
    });

    describe('XRP derivation', () => {
      it('should derive valid XRP address', async () => {
        const result = await deriveSystemPaymentAddress('XRP', 0);
        // XRP addresses start with r
        expect(result.address).toMatch(/^r[a-km-zA-HJ-NP-Z1-9]{24,34}$/);
        expect(result.cryptocurrency).toBe('XRP');
        expect(result.derivationPath).toBe("m/44'/144'/0'/0/0");
      });

      it('should derive different addresses for different indexes', async () => {
        const result0 = await deriveSystemPaymentAddress('XRP', 0);
        const result1 = await deriveSystemPaymentAddress('XRP', 1);
        expect(result0.address).not.toBe(result1.address);
      });
    });

    describe('ADA derivation', () => {
      it('should derive ADA address (simplified)', async () => {
        const result = await deriveSystemPaymentAddress('ADA', 0);
        // Simplified ADA address format
        expect(result.address).toMatch(/^addr1_[a-f0-9]+\.\.\.$/);
        expect(result.cryptocurrency).toBe('ADA');
        expect(result.derivationPath).toBe("m/44'/1815'/0'/0'");
      });

      it('should derive different addresses for different indexes', async () => {
        const result0 = await deriveSystemPaymentAddress('ADA', 0);
        const result1 = await deriveSystemPaymentAddress('ADA', 1);
        expect(result0.address).not.toBe(result1.address);
      });
    });

    describe('Error handling', () => {
      it('should throw error for missing mnemonic', async () => {
        delete process.env.SYSTEM_MNEMONIC_BTC;
        
        await expect(deriveSystemPaymentAddress('BTC', 0)).rejects.toThrow(
          /System mnemonic not configured for BTC/
        );
      });

      it('should throw error for invalid mnemonic', async () => {
        process.env.SYSTEM_MNEMONIC_BTC = 'invalid mnemonic words here';
        
        await expect(deriveSystemPaymentAddress('BTC', 0)).rejects.toThrow(
          /Invalid system mnemonic for BTC/
        );
      });

      it('should throw error for unsupported cryptocurrency', async () => {
        await expect(
          deriveSystemPaymentAddress('INVALID' as SystemBlockchain, 0)
        ).rejects.toThrow(/Unsupported cryptocurrency/);
      });
    });
  });

  describe('Address determinism', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.SYSTEM_MNEMONIC_BTC = TEST_MNEMONIC;
      process.env.SYSTEM_MNEMONIC_ETH = TEST_MNEMONIC;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should generate deterministic BTC addresses from known mnemonic', async () => {
      // Known addresses for "abandon" mnemonic at index 0
      const result = await deriveSystemPaymentAddress('BTC', 0);
      // This is the expected address for the test mnemonic
      expect(result.address).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
    });

    it('should generate deterministic ETH addresses from known mnemonic', async () => {
      const result = await deriveSystemPaymentAddress('ETH', 0);
      // This is the expected address for the test mnemonic
      expect(result.address.toLowerCase()).toBe('0x9858effd232b4033e47d90003d41ec34ecaeda94');
    });
  });
});