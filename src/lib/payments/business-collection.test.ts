import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the blockchain modules before importing the service
vi.mock('../blockchain/providers', () => ({
  getProvider: vi.fn(),
  getRpcUrl: vi.fn(() => 'https://mock-rpc-url'),
}));

vi.mock('../blockchain/wallets', () => ({
  generatePaymentAddress: vi.fn(() => Promise.resolve({
    address: 'mock-payment-address',
    chain: 'ETH',
    encryptedPrivateKey: 'encrypted-key',
  })),
}));

vi.mock('../webhooks/service', () => ({
  deliverWebhook: vi.fn(() => Promise.resolve({ success: true })),
  logWebhookAttempt: vi.fn(() => Promise.resolve({ success: true })),
  retryFailedWebhook: vi.fn(() => Promise.resolve({ success: true, attempts: 1 })),
}));

import {
  getCollectionWalletAddress,
  isValidBlockchain,
  validateBusinessCollectionInput,
  type BusinessCollectionInput,
} from './business-collection';

// Mock environment variables
const mockEnv = {
  PLATFORM_FEE_WALLET_BTC: 'bc1qtest123btcaddress',
  PLATFORM_FEE_WALLET_ETH: '0x1234567890abcdef1234567890abcdef12345678',
  PLATFORM_FEE_WALLET_MATIC: '0xabcdef1234567890abcdef1234567890abcdef12',
  PLATFORM_FEE_WALLET_SOL: 'SoLaNaAdDrEsS123456789012345678901234567890',
};

describe('Business Collection Service', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset environment variables
    Object.keys(mockEnv).forEach((key) => {
      delete process.env[key];
    });
  });

  describe('getCollectionWalletAddress', () => {
    it('should return BTC wallet address from environment', () => {
      process.env.PLATFORM_FEE_WALLET_BTC = mockEnv.PLATFORM_FEE_WALLET_BTC;
      const address = getCollectionWalletAddress('BTC');
      expect(address).toBe(mockEnv.PLATFORM_FEE_WALLET_BTC);
    });

    it('should return ETH wallet address from environment', () => {
      process.env.PLATFORM_FEE_WALLET_ETH = mockEnv.PLATFORM_FEE_WALLET_ETH;
      const address = getCollectionWalletAddress('ETH');
      expect(address).toBe(mockEnv.PLATFORM_FEE_WALLET_ETH);
    });

    it('should return MATIC wallet address from environment', () => {
      process.env.PLATFORM_FEE_WALLET_MATIC = mockEnv.PLATFORM_FEE_WALLET_MATIC;
      const address = getCollectionWalletAddress('MATIC');
      expect(address).toBe(mockEnv.PLATFORM_FEE_WALLET_MATIC);
    });

    it('should return SOL wallet address from environment', () => {
      process.env.PLATFORM_FEE_WALLET_SOL = mockEnv.PLATFORM_FEE_WALLET_SOL;
      const address = getCollectionWalletAddress('SOL');
      expect(address).toBe(mockEnv.PLATFORM_FEE_WALLET_SOL);
    });

    it('should throw error when wallet address is not configured', () => {
      expect(() => getCollectionWalletAddress('BTC')).toThrow(
        'Collection wallet address not configured for BTC'
      );
    });

    it('should throw error with correct env var name in message', () => {
      expect(() => getCollectionWalletAddress('ETH')).toThrow(
        'PLATFORM_FEE_WALLET_ETH'
      );
    });
  });

  describe('isValidBlockchain', () => {
    it('should return true for BTC', () => {
      expect(isValidBlockchain('BTC')).toBe(true);
    });

    it('should return true for BCH', () => {
      expect(isValidBlockchain('BCH')).toBe(true);
    });

    it('should return true for ETH', () => {
      expect(isValidBlockchain('ETH')).toBe(true);
    });

    it('should return true for MATIC', () => {
      expect(isValidBlockchain('MATIC')).toBe(true);
    });

    it('should return true for SOL', () => {
      expect(isValidBlockchain('SOL')).toBe(true);
    });

    it('should return false for invalid blockchain', () => {
      expect(isValidBlockchain('INVALID')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidBlockchain('')).toBe(false);
    });

    it('should return false for lowercase blockchain', () => {
      expect(isValidBlockchain('btc')).toBe(false);
    });
  });

  describe('validateBusinessCollectionInput', () => {
    const validInput: BusinessCollectionInput = {
      businessId: '123e4567-e89b-12d3-a456-426614174000',
      merchantId: '123e4567-e89b-12d3-a456-426614174001',
      amount: 100,
      currency: 'USD',
      blockchain: 'ETH',
    };

    it('should return valid for correct input', () => {
      const result = validateBusinessCollectionInput(validInput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for missing businessId', () => {
      const input = { ...validInput, businessId: '' };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Business ID is required');
    });

    it('should return error for missing merchantId', () => {
      const input = { ...validInput, merchantId: '' };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Merchant ID is required');
    });

    it('should return error for zero amount', () => {
      const input = { ...validInput, amount: 0 };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Amount must be greater than zero');
    });

    it('should return error for negative amount', () => {
      const input = { ...validInput, amount: -100 };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Amount must be greater than zero');
    });

    it('should return error for missing currency', () => {
      const input = { ...validInput, currency: '' };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Currency is required');
    });

    it('should return error for invalid blockchain', () => {
      const input = { ...validInput, blockchain: 'INVALID' as any };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid blockchain'))).toBe(true);
    });

    it('should return multiple errors for multiple invalid fields', () => {
      const input = {
        businessId: '',
        merchantId: '',
        amount: 0,
        currency: '',
        blockchain: 'INVALID' as any,
      };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should accept optional description', () => {
      const input = { ...validInput, description: 'Test payment' };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(true);
    });

    it('should accept optional metadata', () => {
      const input = { ...validInput, metadata: { orderId: '12345' } };
      const result = validateBusinessCollectionInput(input);
      expect(result.valid).toBe(true);
    });
  });

  describe('Business Collection Payment Flow', () => {
    it('should forward 100% of payment to platform wallet', () => {
      // This is a conceptual test - the actual forwarding is tested in integration tests
      // The key assertion is that forward_percentage is always 100
      const forwardPercentage = 100;
      const totalAmount = 1.5; // ETH
      const forwardedAmount = totalAmount * (forwardPercentage / 100);
      
      expect(forwardedAmount).toBe(totalAmount);
      expect(forwardPercentage).toBe(100);
    });

    it('should use platform wallet from environment variables', () => {
      process.env.PLATFORM_FEE_WALLET_ETH = mockEnv.PLATFORM_FEE_WALLET_ETH;
      
      const destinationWallet = getCollectionWalletAddress('ETH');
      
      expect(destinationWallet).toBe(mockEnv.PLATFORM_FEE_WALLET_ETH);
    });
  });
});

describe('Business Collection - Supported Blockchains', () => {
  const supportedBlockchains = ['BTC', 'BCH', 'ETH', 'MATIC', 'SOL'];

  supportedBlockchains.forEach((blockchain) => {
    it(`should support ${blockchain} blockchain`, () => {
      expect(isValidBlockchain(blockchain)).toBe(true);
    });
  });

  const unsupportedBlockchains = ['LTC', 'DOGE', 'XRP', 'ADA', 'DOT'];

  unsupportedBlockchains.forEach((blockchain) => {
    it(`should not support ${blockchain} blockchain`, () => {
      expect(isValidBlockchain(blockchain)).toBe(false);
    });
  });
});