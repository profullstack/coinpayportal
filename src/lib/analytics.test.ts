import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  trackEvent,
  trackCheckout,
  trackPaymentComplete,
  trackSignup,
  trackPageView,
  trackClick,
} from './analytics';

describe('Analytics Utility', () => {
  beforeEach(() => {
    // Reset window.datafast mock before each test
    vi.stubGlobal('window', {
      datafast: vi.fn(),
    });
  });

  describe('trackEvent', () => {
    it('should call window.datafast with event name and data', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackEvent('test_event', { key: 'value' });

      expect(mockDatafast).toHaveBeenCalledWith('test_event', { key: 'value' });
    });

    it('should handle missing data parameter', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackEvent('test_event');

      expect(mockDatafast).toHaveBeenCalledWith('test_event', undefined);
    });

    it('should not throw if window.datafast is undefined', () => {
      global.window = {} as any;

      expect(() => trackEvent('test_event')).not.toThrow();
    });
  });

  describe('trackCheckout', () => {
    it('should track checkout with all data fields', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      const checkoutData = {
        name: 'John Doe',
        email: 'john@example.com',
        product_id: 'prod_123',
        amount: 100.50,
        currency: 'USD',
      };

      trackCheckout(checkoutData);

      expect(mockDatafast).toHaveBeenCalledWith('initiate_checkout', checkoutData);
    });

    it('should track checkout with partial data', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackCheckout({ email: 'test@example.com' });

      expect(mockDatafast).toHaveBeenCalledWith('initiate_checkout', {
        email: 'test@example.com',
      });
    });
  });

  describe('trackPaymentComplete', () => {
    it('should track payment completion with required fields', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      const paymentData = {
        payment_id: 'pay_123',
        amount: 50.00,
        currency: 'USD',
        crypto: 'BTC',
      };

      trackPaymentComplete(paymentData);

      expect(mockDatafast).toHaveBeenCalledWith('payment_complete', paymentData);
    });
  });

  describe('trackSignup', () => {
    it('should track signup with email and method', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackSignup({ email: 'user@example.com', method: 'google' });

      expect(mockDatafast).toHaveBeenCalledWith('signup', {
        email: 'user@example.com',
        method: 'google',
      });
    });

    it('should track signup with empty data', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackSignup({});

      expect(mockDatafast).toHaveBeenCalledWith('signup', {});
    });
  });

  describe('trackPageView', () => {
    it('should track page view with page name', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackPageView('/docs');

      expect(mockDatafast).toHaveBeenCalledWith('page_view', { page: '/docs' });
    });
  });

  describe('trackClick', () => {
    it('should track button click with button name', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackClick('get_started');

      expect(mockDatafast).toHaveBeenCalledWith('click', { button: 'get_started' });
    });

    it('should track button click with additional data', () => {
      const mockDatafast = vi.fn();
      global.window = { datafast: mockDatafast } as any;

      trackClick('signup_button', { page: 'home', position: 'header' });

      expect(mockDatafast).toHaveBeenCalledWith('click', {
        button: 'signup_button',
        page: 'home',
        position: 'header',
      });
    });
  });
});