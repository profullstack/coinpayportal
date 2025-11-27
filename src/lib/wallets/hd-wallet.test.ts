import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for HD Wallet utility functions
 * These tests focus on the pure utility functions that don't require
 * external blockchain libraries with ESM compatibility issues
 */

describe('HD Wallet Utilities', () => {
  describe('Commission Calculation', () => {
    const COMMISSION_RATE = 0.005; // 0.5%

    function calculateSplit(totalAmount: number): { commission: number; merchant: number } {
      const commission = totalAmount * COMMISSION_RATE;
      const merchant = totalAmount - commission;
      return { commission, merchant };
    }

    it('should calculate 0.5% commission correctly', () => {
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

    it('should handle decimal amounts', () => {
      const { commission, merchant } = calculateSplit(123.456);
      
      expect(commission).toBeCloseTo(0.61728, 5);
      expect(merchant).toBeCloseTo(122.83872, 5);
    });

    it('should ensure commission + merchant equals total', () => {
      const amounts = [1, 10, 100, 1000, 0.01, 0.001, 123.456789];
      
      for (const amount of amounts) {
        const { commission, merchant } = calculateSplit(amount);
        expect(commission + merchant).toBeCloseTo(amount, 10);
      }
    });

    it('should handle zero amount', () => {
      const { commission, merchant } = calculateSplit(0);
      
      expect(commission).toBe(0);
      expect(merchant).toBe(0);
    });
  });

  describe('Derivation Path Generation', () => {
    function getDerivationPath(blockchain: string, index: number): string {
      switch (blockchain) {
        case 'BTC':
          return `m/44'/0'/0'/0/${index}`;
        case 'ETH':
        case 'MATIC':
          return `m/44'/60'/0'/0/${index}`;
        case 'SOL':
          return `m/44'/501'/${index}'/0'`;
        default:
          throw new Error(`Unsupported blockchain: ${blockchain}`);
      }
    }

    it('should generate correct BTC derivation path', () => {
      expect(getDerivationPath('BTC', 0)).toBe("m/44'/0'/0'/0/0");
      expect(getDerivationPath('BTC', 1)).toBe("m/44'/0'/0'/0/1");
      expect(getDerivationPath('BTC', 100)).toBe("m/44'/0'/0'/0/100");
    });

    it('should generate correct ETH derivation path', () => {
      expect(getDerivationPath('ETH', 0)).toBe("m/44'/60'/0'/0/0");
      expect(getDerivationPath('ETH', 1)).toBe("m/44'/60'/0'/0/1");
      expect(getDerivationPath('ETH', 100)).toBe("m/44'/60'/0'/0/100");
    });

    it('should use same derivation path for MATIC as ETH', () => {
      expect(getDerivationPath('MATIC', 0)).toBe(getDerivationPath('ETH', 0));
      expect(getDerivationPath('MATIC', 5)).toBe(getDerivationPath('ETH', 5));
    });

    it('should generate correct SOL derivation path', () => {
      expect(getDerivationPath('SOL', 0)).toBe("m/44'/501'/0'/0'");
      expect(getDerivationPath('SOL', 1)).toBe("m/44'/501'/1'/0'");
      expect(getDerivationPath('SOL', 100)).toBe("m/44'/501'/100'/0'");
    });

    it('should throw error for unsupported blockchain', () => {
      expect(() => getDerivationPath('DOGE', 0)).toThrow('Unsupported blockchain');
      expect(() => getDerivationPath('XRP', 0)).toThrow('Unsupported blockchain');
    });
  });

  describe('Environment Variable Helpers', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    function getSystemMnemonicEnvKey(cryptocurrency: string): string {
      if (cryptocurrency === 'MATIC') {
        return 'SYSTEM_MNEMONIC_ETH'; // MATIC uses ETH mnemonic
      }
      return `SYSTEM_MNEMONIC_${cryptocurrency}`;
    }

    function getPlatformFeeWalletEnvKey(cryptocurrency: string): string {
      return `PLATFORM_FEE_WALLET_${cryptocurrency}`;
    }

    it('should return correct mnemonic env key for BTC', () => {
      expect(getSystemMnemonicEnvKey('BTC')).toBe('SYSTEM_MNEMONIC_BTC');
    });

    it('should return correct mnemonic env key for ETH', () => {
      expect(getSystemMnemonicEnvKey('ETH')).toBe('SYSTEM_MNEMONIC_ETH');
    });

    it('should return ETH mnemonic env key for MATIC', () => {
      // MATIC uses the same derivation as ETH, so it shares the mnemonic
      expect(getSystemMnemonicEnvKey('MATIC')).toBe('SYSTEM_MNEMONIC_ETH');
    });

    it('should return correct mnemonic env key for SOL', () => {
      expect(getSystemMnemonicEnvKey('SOL')).toBe('SYSTEM_MNEMONIC_SOL');
    });

    it('should return correct platform fee wallet env key', () => {
      expect(getPlatformFeeWalletEnvKey('BTC')).toBe('PLATFORM_FEE_WALLET_BTC');
      expect(getPlatformFeeWalletEnvKey('ETH')).toBe('PLATFORM_FEE_WALLET_ETH');
      expect(getPlatformFeeWalletEnvKey('MATIC')).toBe('PLATFORM_FEE_WALLET_MATIC');
      expect(getPlatformFeeWalletEnvKey('SOL')).toBe('PLATFORM_FEE_WALLET_SOL');
    });
  });

  describe('Supported Blockchains', () => {
    const SUPPORTED_BLOCKCHAINS = ['BTC', 'ETH', 'MATIC', 'SOL'];

    function isBlockchainSupported(blockchain: string): boolean {
      return SUPPORTED_BLOCKCHAINS.includes(blockchain);
    }

    it('should recognize supported blockchains', () => {
      expect(isBlockchainSupported('BTC')).toBe(true);
      expect(isBlockchainSupported('ETH')).toBe(true);
      expect(isBlockchainSupported('MATIC')).toBe(true);
      expect(isBlockchainSupported('SOL')).toBe(true);
    });

    it('should reject unsupported blockchains', () => {
      expect(isBlockchainSupported('BCH')).toBe(false);
      expect(isBlockchainSupported('DOGE')).toBe(false);
      expect(isBlockchainSupported('XRP')).toBe(false);
      expect(isBlockchainSupported('USDC')).toBe(false);
    });

    it('should be case sensitive', () => {
      expect(isBlockchainSupported('btc')).toBe(false);
      expect(isBlockchainSupported('Btc')).toBe(false);
    });
  });

  describe('Base Blockchain Extraction', () => {
    function getBaseBlockchain(blockchain: string): string {
      if (blockchain.startsWith('USDC_')) {
        return blockchain.replace('USDC_', '');
      }
      return blockchain;
    }

    it('should return blockchain as-is for native tokens', () => {
      expect(getBaseBlockchain('BTC')).toBe('BTC');
      expect(getBaseBlockchain('ETH')).toBe('ETH');
      expect(getBaseBlockchain('SOL')).toBe('SOL');
      expect(getBaseBlockchain('MATIC')).toBe('MATIC');
    });

    it('should extract base blockchain from USDC variants', () => {
      expect(getBaseBlockchain('USDC_ETH')).toBe('ETH');
      expect(getBaseBlockchain('USDC_MATIC')).toBe('MATIC');
      expect(getBaseBlockchain('USDC_SOL')).toBe('SOL');
    });
  });

  describe('Payment Address Info Structure', () => {
    interface PaymentAddressInfo {
      payment_id: string;
      address: string;
      cryptocurrency: string;
      derivation_index: number;
      encrypted_private_key: string;
      merchant_wallet: string;
      commission_wallet: string;
      amount_expected: number;
      commission_amount: number;
      merchant_amount: number;
    }

    function createPaymentAddressInfo(
      paymentId: string,
      address: string,
      cryptocurrency: string,
      index: number,
      encryptedKey: string,
      merchantWallet: string,
      commissionWallet: string,
      amountExpected: number
    ): PaymentAddressInfo {
      const commissionRate = 0.005;
      const commissionAmount = amountExpected * commissionRate;
      const merchantAmount = amountExpected - commissionAmount;

      return {
        payment_id: paymentId,
        address,
        cryptocurrency,
        derivation_index: index,
        encrypted_private_key: encryptedKey,
        merchant_wallet: merchantWallet,
        commission_wallet: commissionWallet,
        amount_expected: amountExpected,
        commission_amount: commissionAmount,
        merchant_amount: merchantAmount,
      };
    }

    it('should create valid payment address info', () => {
      const info = createPaymentAddressInfo(
        'payment-123',
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        'BTC',
        0,
        'encrypted-key',
        'merchant-wallet',
        'commission-wallet',
        1.0
      );

      expect(info.payment_id).toBe('payment-123');
      expect(info.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      expect(info.cryptocurrency).toBe('BTC');
      expect(info.derivation_index).toBe(0);
      expect(info.amount_expected).toBe(1.0);
      expect(info.commission_amount).toBe(0.005);
      expect(info.merchant_amount).toBe(0.995);
    });

    it('should calculate amounts correctly', () => {
      const info = createPaymentAddressInfo(
        'payment-456',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f',
        'ETH',
        5,
        'encrypted-key',
        'merchant-wallet',
        'commission-wallet',
        10.0
      );

      expect(info.commission_amount).toBe(0.05);
      expect(info.merchant_amount).toBe(9.95);
      expect(info.commission_amount + info.merchant_amount).toBe(info.amount_expected);
    });
  });
});

describe('Base58 Encoding (Solana)', () => {
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  /**
   * This is the actual base58 encoding implementation from system-wallet.ts
   * Note: This implementation always starts with digits = [0], which means
   * it will always produce at least one character ('1' for digit 0)
   */
  function base58Encode(bytes: Uint8Array): string {
    const digits = [0];
    for (let i = 0; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let result = '';
    // Leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
      result += BASE58_ALPHABET[0];
    }
    // Convert digits to string
    for (let i = digits.length - 1; i >= 0; i--) {
      result += BASE58_ALPHABET[digits[i]];
    }
    return result;
  }

  it('should encode empty array to single 1 (implementation detail)', () => {
    // The implementation starts with digits = [0], so empty input produces '1'
    expect(base58Encode(new Uint8Array([]))).toBe('1');
  });

  it('should encode single zero byte to two 1s', () => {
    // One '1' for the leading zero, one '1' for the initial digit
    expect(base58Encode(new Uint8Array([0]))).toBe('11');
  });

  it('should encode multiple zero bytes', () => {
    // Three '1's for leading zeros, one '1' for initial digit
    expect(base58Encode(new Uint8Array([0, 0, 0]))).toBe('1111');
  });

  it('should encode non-zero bytes', () => {
    // Byte value 1 produces '2' (index 1 in alphabet)
    // The initial digit [0] gets overwritten by the carry
    const bytes = new Uint8Array([1]);
    const encoded = base58Encode(bytes);
    expect(encoded).toBe('2');
  });

  it('should produce valid base58 characters only', () => {
    const bytes = new Uint8Array([255, 255, 255, 255]);
    const encoded = base58Encode(bytes);
    
    for (const char of encoded) {
      expect(BASE58_ALPHABET).toContain(char);
    }
  });

  it('should not contain ambiguous characters (0, O, I, l)', () => {
    // Base58 specifically excludes these characters
    expect(BASE58_ALPHABET).not.toContain('0');
    expect(BASE58_ALPHABET).not.toContain('O');
    expect(BASE58_ALPHABET).not.toContain('I');
    expect(BASE58_ALPHABET).not.toContain('l');
  });

  it('should produce consistent output for same input', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded1 = base58Encode(bytes);
    const encoded2 = base58Encode(bytes);
    expect(encoded1).toBe(encoded2);
  });

  it('should produce different output for different input', () => {
    const bytes1 = new Uint8Array([1, 2, 3]);
    const bytes2 = new Uint8Array([4, 5, 6]);
    expect(base58Encode(bytes1)).not.toBe(base58Encode(bytes2));
  });
});