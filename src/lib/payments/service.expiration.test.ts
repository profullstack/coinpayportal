import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PAYMENT_EXPIRATION_MINUTES,
  isPaymentExpired,
  getPaymentTimeRemaining,
  formatTimeRemaining,
  type Payment,
} from './service';

describe('Payment Expiration Functions', () => {
  describe('PAYMENT_EXPIRATION_MINUTES', () => {
    it('should be 15 minutes', () => {
      expect(PAYMENT_EXPIRATION_MINUTES).toBe(15);
    });
  });

  describe('isPaymentExpired', () => {
    it('should return false for payment without expires_at', () => {
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
      };
      
      expect(isPaymentExpired(payment)).toBe(false);
    });

    it('should return false for payment that has not expired', () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 10);
      
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
        expires_at: futureDate.toISOString(),
      };
      
      expect(isPaymentExpired(payment)).toBe(false);
    });

    it('should return true for payment that has expired', () => {
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 5);
      
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
        expires_at: pastDate.toISOString(),
      };
      
      expect(isPaymentExpired(payment)).toBe(true);
    });

    it('should return true for payment that expired exactly now', () => {
      const now = new Date();
      now.setMilliseconds(now.getMilliseconds() - 1); // Just past
      
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
        expires_at: now.toISOString(),
      };
      
      expect(isPaymentExpired(payment)).toBe(true);
    });
  });

  describe('getPaymentTimeRemaining', () => {
    it('should return 0 for payment without expires_at', () => {
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
      };
      
      expect(getPaymentTimeRemaining(payment)).toBe(0);
    });

    it('should return 0 for expired payment', () => {
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 5);
      
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
        expires_at: pastDate.toISOString(),
      };
      
      expect(getPaymentTimeRemaining(payment)).toBe(0);
    });

    it('should return correct seconds remaining', () => {
      const futureDate = new Date();
      futureDate.setSeconds(futureDate.getSeconds() + 300); // 5 minutes
      
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
        expires_at: futureDate.toISOString(),
      };
      
      const remaining = getPaymentTimeRemaining(payment);
      // Allow 2 second tolerance for test execution time
      expect(remaining).toBeGreaterThanOrEqual(298);
      expect(remaining).toBeLessThanOrEqual(300);
    });

    it('should return approximately 15 minutes for fresh payment', () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + PAYMENT_EXPIRATION_MINUTES);
      
      const payment: Payment = {
        id: 'test-id',
        business_id: 'business-id',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        status: 'pending',
        merchant_wallet_address: '0x123',
        created_at: new Date().toISOString(),
        expires_at: futureDate.toISOString(),
      };
      
      const remaining = getPaymentTimeRemaining(payment);
      const expectedSeconds = PAYMENT_EXPIRATION_MINUTES * 60;
      // Allow 2 second tolerance
      expect(remaining).toBeGreaterThanOrEqual(expectedSeconds - 2);
      expect(remaining).toBeLessThanOrEqual(expectedSeconds);
    });
  });

  describe('formatTimeRemaining', () => {
    it('should format 0 seconds as 00:00', () => {
      expect(formatTimeRemaining(0)).toBe('00:00');
    });

    it('should format negative seconds as 00:00', () => {
      expect(formatTimeRemaining(-10)).toBe('00:00');
    });

    it('should format 30 seconds as 00:30', () => {
      expect(formatTimeRemaining(30)).toBe('00:30');
    });

    it('should format 60 seconds as 01:00', () => {
      expect(formatTimeRemaining(60)).toBe('01:00');
    });

    it('should format 90 seconds as 01:30', () => {
      expect(formatTimeRemaining(90)).toBe('01:30');
    });

    it('should format 5 minutes as 05:00', () => {
      expect(formatTimeRemaining(300)).toBe('05:00');
    });

    it('should format 15 minutes as 15:00', () => {
      expect(formatTimeRemaining(900)).toBe('15:00');
    });

    it('should format 14:59 correctly', () => {
      expect(formatTimeRemaining(899)).toBe('14:59');
    });

    it('should format single digit seconds with leading zero', () => {
      expect(formatTimeRemaining(65)).toBe('01:05');
    });
  });
});

describe('Payment Status Helper Functions', () => {
  describe('getStatusMessage', () => {
    // Import dynamically to avoid circular dependencies
    it('should return correct message for pending status', async () => {
      const { getStatusMessage } = await import('./usePaymentStatus');
      expect(getStatusMessage('pending')).toBe('Waiting for payment...');
    });

    it('should return correct message for expired status', async () => {
      const { getStatusMessage } = await import('./usePaymentStatus');
      expect(getStatusMessage('expired')).toBe('Payment expired');
    });

    it('should return correct message for cancelled status', async () => {
      const { getStatusMessage } = await import('./usePaymentStatus');
      expect(getStatusMessage('cancelled')).toBe('Payment cancelled');
    });

    it('should return correct message for completed status', async () => {
      const { getStatusMessage } = await import('./usePaymentStatus');
      expect(getStatusMessage('completed')).toBe('Payment completed!');
    });

    it('should return confirmation progress for confirming status', async () => {
      const { getStatusMessage } = await import('./usePaymentStatus');
      expect(getStatusMessage('confirming', 2, 6)).toBe('Confirming (2/6 confirmations)');
    });
  });

  describe('getStatusColor', () => {
    it('should return yellow for pending', async () => {
      const { getStatusColor } = await import('./usePaymentStatus');
      expect(getStatusColor('pending')).toBe('yellow');
    });

    it('should return red for expired', async () => {
      const { getStatusColor } = await import('./usePaymentStatus');
      expect(getStatusColor('expired')).toBe('red');
    });

    it('should return gray for cancelled', async () => {
      const { getStatusColor } = await import('./usePaymentStatus');
      expect(getStatusColor('cancelled')).toBe('gray');
    });

    it('should return green for completed', async () => {
      const { getStatusColor } = await import('./usePaymentStatus');
      expect(getStatusColor('completed')).toBe('green');
    });

    it('should return blue for confirming', async () => {
      const { getStatusColor } = await import('./usePaymentStatus');
      expect(getStatusColor('confirming')).toBe('blue');
    });
  });

  describe('calculateConfirmationProgress', () => {
    it('should return 100 when required is 0', async () => {
      const { calculateConfirmationProgress } = await import('./usePaymentStatus');
      expect(calculateConfirmationProgress(0, 0)).toBe(100);
    });

    it('should return 0 when no confirmations', async () => {
      const { calculateConfirmationProgress } = await import('./usePaymentStatus');
      expect(calculateConfirmationProgress(0, 6)).toBe(0);
    });

    it('should return 50 when half confirmed', async () => {
      const { calculateConfirmationProgress } = await import('./usePaymentStatus');
      expect(calculateConfirmationProgress(3, 6)).toBe(50);
    });

    it('should return 100 when fully confirmed', async () => {
      const { calculateConfirmationProgress } = await import('./usePaymentStatus');
      expect(calculateConfirmationProgress(6, 6)).toBe(100);
    });

    it('should cap at 100 when over-confirmed', async () => {
      const { calculateConfirmationProgress } = await import('./usePaymentStatus');
      expect(calculateConfirmationProgress(10, 6)).toBe(100);
    });
  });
});