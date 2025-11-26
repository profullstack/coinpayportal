import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateMnemonic,
  generateWalletFromMnemonic,
  generatePaymentAddress,
  validateAddress,
} from './wallets';

describe('Wallet Generation Service', () => {
  describe('generateMnemonic', () => {
    it('should generate a valid 12-word mnemonic', () => {
      const mnemonic = generateMnemonic();
      const words = mnemonic.split(' ');
      expect(words).toHaveLength(12);
    });

    it('should generate different mnemonics each time', () => {
      const mnemonic1 = generateMnemonic();
      const mnemonic2 = generateMnemonic();
      expect(mnemonic1).not.toBe(mnemonic2);
    });

    it('should generate valid BIP39 mnemonics', () => {
      const mnemonic = generateMnemonic();
      // Each word should be lowercase and contain only letters
      const words = mnemonic.split(' ');
      words.forEach((word) => {
        expect(word).toMatch(/^[a-z]+$/);
      });
    });
  });

  describe('generateWalletFromMnemonic', () => {
    const testMnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('should generate Bitcoin wallet from mnemonic', async () => {
      const wallet = await generateWalletFromMnemonic(testMnemonic, 'BTC', 0);
      expect(wallet).toHaveProperty('address');
      expect(wallet).toHaveProperty('privateKey');
      expect(wallet).toHaveProperty('publicKey');
      expect(wallet.chain).toBe('BTC');
    });

    it('should generate Ethereum wallet from mnemonic', async () => {
      const wallet = await generateWalletFromMnemonic(testMnemonic, 'ETH', 0);
      expect(wallet).toHaveProperty('address');
      expect(wallet).toHaveProperty('privateKey');
      expect(wallet).toHaveProperty('publicKey');
      expect(wallet.chain).toBe('ETH');
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should generate Polygon wallet from mnemonic', async () => {
      const wallet = await generateWalletFromMnemonic(testMnemonic, 'MATIC', 0);
      expect(wallet).toHaveProperty('address');
      expect(wallet.chain).toBe('MATIC');
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should generate Solana wallet from mnemonic', async () => {
      const wallet = await generateWalletFromMnemonic(testMnemonic, 'SOL', 0);
      expect(wallet).toHaveProperty('address');
      expect(wallet).toHaveProperty('privateKey');
      expect(wallet.chain).toBe('SOL');
    });

    it('should generate different addresses for different indices', async () => {
      const wallet1 = await generateWalletFromMnemonic(testMnemonic, 'ETH', 0);
      const wallet2 = await generateWalletFromMnemonic(testMnemonic, 'ETH', 1);
      expect(wallet1.address).not.toBe(wallet2.address);
    });

    it('should generate same address for same mnemonic and index', async () => {
      const wallet1 = await generateWalletFromMnemonic(testMnemonic, 'ETH', 0);
      const wallet2 = await generateWalletFromMnemonic(testMnemonic, 'ETH', 0);
      expect(wallet1.address).toBe(wallet2.address);
    });

    it('should throw error for invalid chain', async () => {
      await expect(
        generateWalletFromMnemonic(testMnemonic, 'INVALID' as any, 0)
      ).rejects.toThrow();
    });
  });

  describe('generatePaymentAddress', () => {
    it('should generate unique payment address for business', async () => {
      const address = await generatePaymentAddress('business-123', 'ETH');
      expect(address).toHaveProperty('address');
      expect(address).toHaveProperty('chain');
      expect(address.chain).toBe('ETH');
    });

    it('should generate different addresses for different businesses', async () => {
      const address1 = await generatePaymentAddress('business-123', 'ETH');
      const address2 = await generatePaymentAddress('business-456', 'ETH');
      expect(address1.address).not.toBe(address2.address);
    });

    it('should support all blockchain types', async () => {
      const chains: Array<'BTC' | 'ETH' | 'MATIC' | 'SOL'> = [
        'BTC',
        'ETH',
        'MATIC',
        'SOL',
      ];
      for (const chain of chains) {
        const address = await generatePaymentAddress('business-123', chain);
        expect(address.chain).toBe(chain);
        expect(address.address).toBeTruthy();
      }
    });
  });

  describe('validateAddress', () => {
    it('should validate Bitcoin addresses', () => {
      expect(validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'BTC')).toBe(
        true
      );
      expect(validateAddress('invalid-btc-address', 'BTC')).toBe(false);
    });

    it('should validate Ethereum addresses', () => {
      expect(
        validateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', 'ETH')
      ).toBe(true);
      expect(validateAddress('invalid-eth-address', 'ETH')).toBe(false);
      expect(validateAddress('0xinvalid', 'ETH')).toBe(false);
    });

    it('should validate Polygon addresses', () => {
      expect(
        validateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', 'MATIC')
      ).toBe(true);
      expect(validateAddress('invalid-matic-address', 'MATIC')).toBe(false);
    });

    it('should validate Solana addresses', () => {
      expect(
        validateAddress(
          '7EqQdEUyyibKFhAJ9JxHV4kX6xU7RJvKvAjM5ZqEJqKd',
          'SOL'
        )
      ).toBe(true);
      expect(validateAddress('invalid-sol-address', 'SOL')).toBe(false);
    });

    it('should return false for empty addresses', () => {
      expect(validateAddress('', 'ETH')).toBe(false);
      expect(validateAddress('', 'BTC')).toBe(false);
    });
  });
});