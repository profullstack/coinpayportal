import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculatePlatformFee, createGatewayCharge, createEscrowCharge } from './payments';

const mockCreate = vi.fn();
vi.mock('./client', () => ({
  getStripeClient: () => ({
    paymentIntents: { create: mockCreate },
  }),
}));

describe('Payments', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('calculatePlatformFee', () => {
    it('should calculate 1% for free tier', () => {
      expect(calculatePlatformFee(10000, 'free')).toBe(100);
    });

    it('should calculate 0.5% for pro tier', () => {
      expect(calculatePlatformFee(10000, 'pro')).toBe(50);
    });

    it('should round to nearest cent', () => {
      expect(calculatePlatformFee(333, 'free')).toBe(3);
      expect(calculatePlatformFee(333, 'pro')).toBe(2);
    });

    it('should handle zero amount', () => {
      expect(calculatePlatformFee(0, 'free')).toBe(0);
    });
  });

  describe('createGatewayCharge', () => {
    it('should create a destination charge with platform fee', async () => {
      mockCreate.mockResolvedValue({ id: 'pi_123', client_secret: 'secret' });

      const result = await createGatewayCharge({
        amount: 5000,
        currency: 'usd',
        stripeAccountId: 'acct_123',
        merchantTier: 'free',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: 'usd',
          application_fee_amount: 50,
          transfer_data: { destination: 'acct_123' },
        })
      );
      expect(result.id).toBe('pi_123');
    });
  });

  describe('createEscrowCharge', () => {
    it('should create a platform charge for escrow', async () => {
      mockCreate.mockResolvedValue({ id: 'pi_456', client_secret: 'secret2' });

      const result = await createEscrowCharge({
        amount: 10000,
        currency: 'usd',
        merchantId: 'merch_1',
        merchantTier: 'pro',
        releaseAfterDays: 14,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000,
          currency: 'usd',
          metadata: expect.objectContaining({
            mode: 'escrow',
            coinpay_merchant_id: 'merch_1',
            platform_fee: '50',
            release_after_days: '14',
          }),
        })
      );
      // Should NOT have transfer_data (platform holds funds)
      expect(mockCreate.mock.calls[0][0].transfer_data).toBeUndefined();
      expect(result.id).toBe('pi_456');
    });
  });
});
