import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  forwardPayment,
  calculateForwardingAmounts,
  validateForwardingInput,
  getForwardingStatus,
  retryFailedForwarding,
  type ForwardingInput,
  type ForwardingResult,
} from './forwarding';
import { splitPayment } from './fees';

// Mock the blockchain providers
vi.mock('../blockchain/providers', () => ({
  getProvider: vi.fn(() => ({
    sendTransaction: vi.fn().mockResolvedValue('0xmocktxhash123'),
    getBalance: vi.fn().mockResolvedValue('1.5'),
    getTransaction: vi.fn().mockResolvedValue({
      hash: '0xmocktxhash123',
      confirmations: 12,
      status: 'confirmed',
    }),
  })),
  getRpcUrl: vi.fn(() => 'https://mock-rpc.com'),
}));

// Mock Supabase
const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'payment-123',
            business_id: 'business-456',
            crypto_amount: 1.0,
            blockchain: 'ETH',
            status: 'confirmed',
            payment_address: '0xpaymentaddress',
            merchant_wallet_address: '0xmerchantaddress',
          },
          error: null,
        }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'payment-123', status: 'forwarded' },
            error: null,
          }),
        })),
      })),
    })),
  })),
};

describe('Payment Forwarding Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateForwardingAmounts', () => {
    it('should calculate correct amounts for merchant and platform', () => {
      const totalAmount = 1.0; // 1 ETH
      const result = calculateForwardingAmounts(totalAmount);

      expect(result.merchantAmount).toBeDefined();
      expect(result.platformFee).toBeDefined();
      expect(result.total).toBe(totalAmount);
      expect(result.merchantAmount + result.platformFee).toBeCloseTo(totalAmount, 8);
    });

    it('should give merchant 99.5% of the payment', () => {
      const totalAmount = 100;
      const result = calculateForwardingAmounts(totalAmount);

      // 0.5% fee means merchant gets 99.5%
      expect(result.merchantAmount).toBeCloseTo(99.5, 2);
      expect(result.platformFee).toBeCloseTo(0.5, 2);
    });

    it('should handle small amounts correctly', () => {
      const totalAmount = 0.001; // Small crypto amount
      const result = calculateForwardingAmounts(totalAmount);

      expect(result.merchantAmount).toBeGreaterThan(0);
      expect(result.platformFee).toBeGreaterThan(0);
      expect(result.merchantAmount + result.platformFee).toBeCloseTo(totalAmount, 8);
    });

    it('should handle large amounts correctly', () => {
      const totalAmount = 1000000; // Large amount
      const result = calculateForwardingAmounts(totalAmount);

      expect(result.merchantAmount).toBeCloseTo(995000, 2);
      expect(result.platformFee).toBeCloseTo(5000, 2);
    });

    it('should throw error for zero amount', () => {
      expect(() => calculateForwardingAmounts(0)).toThrow('Amount must be greater than zero');
    });

    it('should throw error for negative amount', () => {
      expect(() => calculateForwardingAmounts(-1)).toThrow('Amount must be greater than zero');
    });
  });

  describe('validateForwardingInput', () => {
    const validInput: ForwardingInput = {
      paymentId: 'payment-123',
      paymentAddress: '0xpaymentaddress',
      merchantWalletAddress: '0xmerchantaddress',
      platformWalletAddress: '0xplatformaddress',
      totalAmount: 1.0,
      blockchain: 'ETH',
    };

    it('should validate correct input', () => {
      const result = validateForwardingInput(validInput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing payment ID', () => {
      const input = { ...validInput, paymentId: '' };
      const result = validateForwardingInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Payment ID is required');
    });

    it('should reject missing payment address', () => {
      const input = { ...validInput, paymentAddress: '' };
      const result = validateForwardingInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Payment address is required');
    });

    it('should reject missing merchant wallet address', () => {
      const input = { ...validInput, merchantWalletAddress: '' };
      const result = validateForwardingInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Merchant wallet address is required');
    });

    it('should reject missing platform wallet address', () => {
      const input = { ...validInput, platformWalletAddress: '' };
      const result = validateForwardingInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Platform wallet address is required');
    });

    it('should reject zero amount', () => {
      const input = { ...validInput, totalAmount: 0 };
      const result = validateForwardingInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Amount must be greater than zero');
    });

    it('should reject invalid blockchain', () => {
      const input = { ...validInput, blockchain: 'INVALID' as any };
      const result = validateForwardingInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid blockchain type');
    });

    it('should accept all valid blockchains', () => {
      const blockchains = ['BTC', 'BCH', 'ETH', 'POL', 'SOL'];
      blockchains.forEach((blockchain) => {
        const input = { ...validInput, blockchain: blockchain as any };
        const result = validateForwardingInput(input);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('forwardPayment', () => {
    const validInput: ForwardingInput = {
      paymentId: 'payment-123',
      paymentAddress: '0xpaymentaddress',
      merchantWalletAddress: '0xmerchantaddress',
      platformWalletAddress: '0xplatformaddress',
      totalAmount: 1.0,
      blockchain: 'ETH',
      privateKey: '0xprivatekey',
    };

    it('should forward payment successfully', async () => {
      const result = await forwardPayment(mockSupabase as any, validInput);

      expect(result.success).toBe(true);
      expect(result.merchantTxHash).toBeDefined();
      expect(result.platformTxHash).toBeDefined();
      expect(result.merchantAmount).toBeDefined();
      expect(result.platformFee).toBeDefined();
    });

    it('should return error for invalid input', async () => {
      const invalidInput = { ...validInput, paymentId: '' };
      const result = await forwardPayment(mockSupabase as any, invalidInput);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should calculate correct split amounts', async () => {
      const result = await forwardPayment(mockSupabase as any, validInput);

      if (result.success) {
        const expectedSplit = splitPayment(validInput.totalAmount);
        expect(result.merchantAmount).toBeCloseTo(expectedSplit.merchantAmount, 8);
        expect(result.platformFee).toBeCloseTo(expectedSplit.platformFee, 8);
      }
    });
  });

  describe('getForwardingStatus', () => {
    it('should return forwarding status for a payment', async () => {
      const status = await getForwardingStatus(mockSupabase as any, 'payment-123');

      expect(status).toBeDefined();
      expect(status.paymentId).toBe('payment-123');
    });

    it('should return error for non-existent payment', async () => {
      const mockSupabaseError = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Payment not found' },
              }),
            })),
          })),
        })),
      };

      const status = await getForwardingStatus(mockSupabaseError as any, 'nonexistent');
      expect(status.error).toBeDefined();
    });
  });

  describe('retryFailedForwarding', () => {
    it('should retry failed forwarding', async () => {
      const mockSupabaseWithFailedPayment = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'payment-123',
                  business_id: 'business-456',
                  crypto_amount: 1.0,
                  blockchain: 'ETH',
                  status: 'forwarding_failed',
                  payment_address: '0xpaymentaddress',
                  merchant_wallet_address: '0xmerchantaddress',
                },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'payment-123', status: 'forwarded' },
                  error: null,
                }),
              })),
            })),
          })),
        })),
      };

      const result = await retryFailedForwarding(
        mockSupabaseWithFailedPayment as any,
        'payment-123',
        '0xprivatekey'
      );

      expect(result.success).toBeDefined();
    });

    it('should not retry already forwarded payments', async () => {
      const mockSupabaseForwarded = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'payment-123',
                  status: 'forwarded',
                },
                error: null,
              }),
            })),
          })),
        })),
      };

      const result = await retryFailedForwarding(
        mockSupabaseForwarded as any,
        'payment-123',
        '0xprivatekey'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already forwarded');
    });
  });

  describe('Integration with fee calculations', () => {
    it('should use consistent fee calculations', () => {
      const amount = 10.0;
      const forwardingAmounts = calculateForwardingAmounts(amount);
      const feeAmounts = splitPayment(amount);

      expect(forwardingAmounts.merchantAmount).toBeCloseTo(feeAmounts.merchantAmount, 8);
      expect(forwardingAmounts.platformFee).toBeCloseTo(feeAmounts.platformFee, 8);
    });

    it('should handle edge case amounts', () => {
      const edgeCases = [0.00000001, 0.001, 1, 100, 10000, 999999.99999999];

      edgeCases.forEach((amount) => {
        const result = calculateForwardingAmounts(amount);
        expect(result.merchantAmount + result.platformFee).toBeCloseTo(amount, 8);
      });
    });
  });
});