/**
 * Card Payments Module Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createQuickCardPayment,
  waitForStripeOnboarding,
  createCardPaymentWithOnboardingCheck,
  getPaymentMethodSupport,
  formatCardAmount,
  calculateCardPaymentFees,
  createCardEscrow,
  listCardEscrows,
  releaseCardEscrow,
  refundCardEscrow,
  getCardEscrowStatus,
} from '../src/card-payments.js';

// Mock CoinPayClient
const mockClient = {
  createCardPayment: vi.fn(),
  getStripeAccountStatus: vi.fn(),
  createStripeOnboardingLink: vi.fn(),
  getBusiness: vi.fn(),
  request: vi.fn(),
};

describe('Card Payments Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createQuickCardPayment', () => {
    it('should create a card payment with correct amount conversion', async () => {
      const mockResponse = {
        id: 'pi_test123',
        checkout_url: 'https://checkout.stripe.com/pay/test123'
      };
      mockClient.createCardPayment.mockResolvedValue(mockResponse);

      const result = await createQuickCardPayment(mockClient, 'business-id', 50.25, 'Test payment');

      expect(mockClient.createCardPayment).toHaveBeenCalledWith({
        businessId: 'business-id',
        amount: 5025, // $50.25 in cents
        currency: 'usd',
        description: 'Test payment',
        metadata: {},
        successUrl: undefined,
        cancelUrl: undefined,
        escrowMode: false,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle escrow mode and metadata options', async () => {
      const mockResponse = { id: 'pi_escrow123', checkout_url: 'https://example.com' };
      mockClient.createCardPayment.mockResolvedValue(mockResponse);

      const options = {
        metadata: { orderId: '123' },
        successUrl: 'https://success.com',
        cancelUrl: 'https://cancel.com',
        escrowMode: true,
      };

      await createQuickCardPayment(mockClient, 'biz', 100, 'Escrow payment', options);

      expect(mockClient.createCardPayment).toHaveBeenCalledWith({
        businessId: 'biz',
        amount: 10000,
        currency: 'usd',
        description: 'Escrow payment',
        metadata: { orderId: '123' },
        successUrl: 'https://success.com',
        cancelUrl: 'https://cancel.com',
        escrowMode: true,
      });
    });
  });

  describe('waitForStripeOnboarding', () => {
    it('should poll until onboarding is complete', async () => {
      let callCount = 0;
      mockClient.getStripeAccountStatus.mockImplementation(() => {
        callCount++;
        if (callCount >= 3) {
          return Promise.resolve({ onboarding_complete: true, account_id: 'acct_123' });
        }
        return Promise.resolve({ onboarding_complete: false });
      });

      const result = await waitForStripeOnboarding(mockClient, 'business-id', {
        intervalMs: 10, // Fast polling for test
        timeoutMs: 1000,
      });

      expect(result.onboarding_complete).toBe(true);
      expect(result.account_id).toBe('acct_123');
      expect(callCount).toBe(3);
    });

    it('should timeout if onboarding takes too long', async () => {
      mockClient.getStripeAccountStatus.mockResolvedValue({ onboarding_complete: false });

      await expect(
        waitForStripeOnboarding(mockClient, 'business-id', {
          intervalMs: 10,
          timeoutMs: 50, // Very short timeout
        })
      ).rejects.toThrow('Stripe onboarding timeout after 50ms');
    });

    it('should call onStatusChange callback if provided', async () => {
      const onStatusChange = vi.fn();
      mockClient.getStripeAccountStatus.mockResolvedValue({ onboarding_complete: true });

      await waitForStripeOnboarding(mockClient, 'business-id', {
        intervalMs: 10,
        onStatusChange,
      });

      expect(onStatusChange).toHaveBeenCalledWith({ onboarding_complete: true });
    });
  });

  describe('createCardPaymentWithOnboardingCheck', () => {
    it('should create payment when onboarding is complete', async () => {
      mockClient.getStripeAccountStatus.mockResolvedValue({ onboarding_complete: true });
      mockClient.createCardPayment.mockResolvedValue({ id: 'pi_123', checkout_url: 'https://test.com' });

      const params = {
        businessId: 'business-id',
        amount: 5000,
        description: 'Test payment'
      };

      const result = await createCardPaymentWithOnboardingCheck(mockClient, params);

      expect(result.requires_onboarding).toBe(false);
      expect(result.id).toBe('pi_123');
      expect(mockClient.createCardPayment).toHaveBeenCalledWith(params);
    });

    it('should return onboarding info when incomplete', async () => {
      mockClient.getStripeAccountStatus.mockResolvedValue({ onboarding_complete: false });
      mockClient.createStripeOnboardingLink.mockResolvedValue({ onboarding_url: 'https://onboard.com' });

      const params = { businessId: 'business-id', amount: 5000, description: 'Test' };
      const result = await createCardPaymentWithOnboardingCheck(mockClient, params);

      expect(result.requires_onboarding).toBe(true);
      expect(result.onboarding_url).toBe('https://onboard.com');
      expect(result.message).toBe('Merchant must complete Stripe onboarding before accepting card payments');
      expect(mockClient.createCardPayment).not.toHaveBeenCalled();
    });

    it('should handle 404 error by creating onboarding link', async () => {
      const error404 = new Error('Not found');
      error404.status = 404;
      mockClient.getStripeAccountStatus.mockRejectedValue(error404);
      mockClient.createStripeOnboardingLink.mockResolvedValue({ onboarding_url: 'https://onboard.com' });

      const params = { businessId: 'business-id', amount: 5000, description: 'Test' };
      const result = await createCardPaymentWithOnboardingCheck(mockClient, params);

      expect(result.requires_onboarding).toBe(true);
      expect(result.onboarding_url).toBe('https://onboard.com');
      expect(result.message).toBe('Merchant needs to complete Stripe onboarding');
    });
  });

  describe('getPaymentMethodSupport', () => {
    it('should return full support when all checks pass', async () => {
      mockClient.getBusiness.mockResolvedValue({ id: 'business-id' });
      mockClient.getStripeAccountStatus.mockResolvedValue({ onboarding_complete: true });

      const result = await getPaymentMethodSupport(mockClient, 'business-id');

      expect(result).toEqual({
        crypto: true,
        cards: true,
        escrow: true,
        stripe_onboarding_complete: true,
      });
    });

    it('should return limited support when Stripe onboarding incomplete', async () => {
      mockClient.getBusiness.mockResolvedValue({ id: 'business-id' });
      mockClient.getStripeAccountStatus.mockResolvedValue({ onboarding_complete: false });

      const result = await getPaymentMethodSupport(mockClient, 'business-id');

      expect(result).toEqual({
        crypto: true,
        cards: false,
        escrow: false,
        stripe_onboarding_complete: false,
      });
    });

    it('should handle business not found', async () => {
      const error404 = new Error('Business not found');
      error404.status = 404;
      mockClient.getBusiness.mockRejectedValue(error404);

      const result = await getPaymentMethodSupport(mockClient, 'nonexistent');

      expect(result).toEqual({
        crypto: false,
        cards: false,
        escrow: false,
        stripe_onboarding_complete: false,
        error: 'Business not found',
      });
    });
  });

  describe('formatCardAmount', () => {
    it('should format USD amounts correctly', () => {
      expect(formatCardAmount(5000)).toBe('$50.00');
      expect(formatCardAmount(5050)).toBe('$50.50');
      expect(formatCardAmount(1)).toBe('$0.01');
      expect(formatCardAmount(12345)).toBe('$123.45');
    });

    it('should format other currencies correctly', () => {
      expect(formatCardAmount(5000, 'EUR')).toBe('€50.00');
      expect(formatCardAmount(5000, 'GBP')).toBe('£50.00');
      expect(formatCardAmount(5000, 'CAD')).toBe('C$50.00');
    });

    it('should handle unknown currencies', () => {
      expect(formatCardAmount(5000, 'JPY')).toBe('50.00 JPY');
      expect(formatCardAmount(5000, 'unknown')).toBe('50.00 UNKNOWN');
    });

    it('should be case insensitive', () => {
      expect(formatCardAmount(5000, 'usd')).toBe('$50.00');
      expect(formatCardAmount(5000, 'eur')).toBe('€50.00');
    });
  });

  describe('calculateCardPaymentFees', () => {
    it('should calculate fees for free tier', () => {
      const fees = calculateCardPaymentFees(5000, 'free');
      
      expect(fees).toEqual({
        amount: 5000,
        platformFee: 50, // 1% of 5000
        platformFeePercent: 1,
        merchantReceives: 4950,
      });
    });

    it('should calculate fees for pro tier', () => {
      const fees = calculateCardPaymentFees(10000, 'pro');
      
      expect(fees).toEqual({
        amount: 10000,
        platformFee: 50, // 0.5% of 10000
        platformFeePercent: 0.5,
        merchantReceives: 9950,
      });
    });

    it('should default to free tier', () => {
      const fees = calculateCardPaymentFees(5000);
      
      expect(fees.platformFeePercent).toBe(1);
      expect(fees.platformFee).toBe(50);
    });

    it('should round fees correctly', () => {
      const fees = calculateCardPaymentFees(5001, 'free'); // Should round to 50 cents
      
      expect(fees.platformFee).toBe(50);
      expect(fees.merchantReceives).toBe(4951);
    });
  });

  // Escrow function tests
  describe('createCardEscrow', () => {
    it('should create escrow payment with correct parameters', async () => {
      const mockResponse = { id: 'escrow_123', checkout_url: 'https://test.com' };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await createCardEscrow(mockClient, 'business-id', 75.50, 'Escrow payment', { orderId: '456' });

      expect(mockClient.request).toHaveBeenCalledWith('POST', '/api/stripe/payments/create', {
        businessId: 'business-id',
        amount: 7550, // $75.50 in cents
        currency: 'usd',
        description: 'Escrow payment',
        metadata: { orderId: '456' },
        escrowMode: true,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle default empty metadata', async () => {
      mockClient.request.mockResolvedValue({ id: 'escrow_123' });

      await createCardEscrow(mockClient, 'business-id', 100, 'Test escrow');

      expect(mockClient.request).toHaveBeenCalledWith('POST', '/api/stripe/payments/create', {
        businessId: 'business-id',
        amount: 10000,
        currency: 'usd',
        description: 'Test escrow',
        metadata: {},
        escrowMode: true,
      });
    });
  });

  describe('listCardEscrows', () => {
    it('should list escrows with no filters', async () => {
      const mockResponse = { escrows: [{ id: 'escrow_1' }, { id: 'escrow_2' }] };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await listCardEscrows(mockClient);

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/api/stripe/escrows');
      expect(result).toEqual(mockResponse);
    });

    it('should list escrows with filters', async () => {
      const mockResponse = { escrows: [{ id: 'escrow_1' }] };
      mockClient.request.mockResolvedValue(mockResponse);

      const options = {
        businessId: 'business-123',
        status: 'pending',
        limit: 10,
        offset: 5,
      };

      const result = await listCardEscrows(mockClient, options);

      expect(mockClient.request).toHaveBeenCalledWith(
        'GET',
        '/api/stripe/escrows?businessId=business-123&status=pending&limit=10&offset=5'
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle partial options', async () => {
      mockClient.request.mockResolvedValue({ escrows: [] });

      await listCardEscrows(mockClient, { businessId: 'biz-123' });

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/api/stripe/escrows?businessId=biz-123');
    });
  });

  describe('releaseCardEscrow', () => {
    it('should release escrow with correct parameters', async () => {
      const mockResponse = { success: true, escrow_id: 'escrow_123' };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await releaseCardEscrow(mockClient, 'escrow_123');

      expect(mockClient.request).toHaveBeenCalledWith('POST', '/api/stripe/escrow/release', {
        escrowId: 'escrow_123',
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('refundCardEscrow', () => {
    it('should refund escrow fully by default', async () => {
      const mockResponse = { success: true, escrow_id: 'escrow_123' };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await refundCardEscrow(mockClient, 'escrow_123');

      expect(mockClient.request).toHaveBeenCalledWith('POST', '/api/stripe/escrow/refund', {
        escrowId: 'escrow_123',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should refund escrow with options', async () => {
      const mockResponse = { success: true, escrow_id: 'escrow_123' };
      mockClient.request.mockResolvedValue(mockResponse);

      const options = {
        amount: 2500,
        reason: 'partial_delivery',
      };

      const result = await refundCardEscrow(mockClient, 'escrow_123', options);

      expect(mockClient.request).toHaveBeenCalledWith('POST', '/api/stripe/escrow/refund', {
        escrowId: 'escrow_123',
        amount: 2500,
        reason: 'partial_delivery',
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getCardEscrowStatus', () => {
    it('should get escrow status with correct parameters', async () => {
      const mockResponse = {
        id: 'escrow_123',
        escrow_status: 'pending',
        amount_cents: 5000,
      };
      mockClient.request.mockResolvedValue(mockResponse);

      const result = await getCardEscrowStatus(mockClient, 'escrow_123');

      expect(mockClient.request).toHaveBeenCalledWith('GET', '/api/stripe/transactions/escrow_123');
      expect(result).toEqual(mockResponse);
    });
  });
});