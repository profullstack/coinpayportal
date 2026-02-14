/**
 * CoinPayClient Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoinPayClient } from '../src/client.js';

describe('CoinPayClient', () => {
  describe('constructor', () => {
    it('should create a client with valid API key', () => {
      const client = new CoinPayClient({ apiKey: 'cp_live_test_api_key_12345678' });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should allow creating client without API key (for auth operations)', () => {
      const client = new CoinPayClient({});
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should allow creating client with empty API key', () => {
      const client = new CoinPayClient({ apiKey: '' });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should use default base URL when not provided', () => {
      const client = new CoinPayClient({ apiKey: 'cp_live_test_key_123456789' });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should accept custom base URL', () => {
      const client = new CoinPayClient({
        apiKey: 'cp_live_test_key_123456789',
        baseUrl: 'https://custom.api.com',
      });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should remove trailing slash from base URL', () => {
      const client = new CoinPayClient({
        apiKey: 'cp_live_test_key_123456789',
        baseUrl: 'https://custom.api.com/',
      });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should accept custom timeout', () => {
      const client = new CoinPayClient({
        apiKey: 'cp_live_test_key_123456789',
        timeout: 60000,
      });
      expect(client).toBeInstanceOf(CoinPayClient);
    });
  });

  describe('request method', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should be a function', () => {
      expect(typeof client.request).toBe('function');
    });

    it('should use Authorization Bearer header', async () => {
      // Mock fetch to capture the request
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      global.fetch = mockFetch;

      await client.request('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer cp_live_test_api_key_12345678',
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  describe('payment methods', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should have createPayment method', () => {
      expect(typeof client.createPayment).toBe('function');
    });

    it('should have getPayment method', () => {
      expect(typeof client.getPayment).toBe('function');
    });

    it('should have listPayments method', () => {
      expect(typeof client.listPayments).toBe('function');
    });

    it('should have getPaymentQR method', () => {
      expect(typeof client.getPaymentQR).toBe('function');
    });

    it('should have getPaymentQRUrl method', () => {
      expect(typeof client.getPaymentQRUrl).toBe('function');
    });
  });

  describe('getPaymentQRUrl', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should return correct QR code URL', () => {
      const url = client.getPaymentQRUrl('pay_abc123');
      expect(url).toBe('https://api.test.com/payments/pay_abc123/qr');
    });

    it('should work with different payment IDs', () => {
      const url = client.getPaymentQRUrl('pay_xyz789');
      expect(url).toBe('https://api.test.com/payments/pay_xyz789/qr');
    });
  });

  describe('waitForPayment', () => {
    let client;
    let mockFetch;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should have waitForPayment method', () => {
      expect(typeof client.waitForPayment).toBe('function');
    });

    it('should return immediately when payment is already confirmed', async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          payment: { id: 'pay_123', status: 'confirmed' },
        }),
      });
      global.fetch = mockFetch;

      const result = await client.waitForPayment('pay_123');

      expect(result.payment.status).toBe('confirmed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should poll until payment reaches target status', async () => {
      let callCount = 0;
      mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        const status = callCount < 3 ? 'pending' : 'confirmed';
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            payment: { id: 'pay_123', status },
          }),
        });
      });
      global.fetch = mockFetch;

      const result = await client.waitForPayment('pay_123', { interval: 10 });

      expect(result.payment.status).toBe('confirmed');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should call onStatusChange callback when status changes', async () => {
      let callCount = 0;
      mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        const status = callCount === 1 ? 'pending' : callCount === 2 ? 'detected' : 'confirmed';
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            payment: { id: 'pay_123', status },
          }),
        });
      });
      global.fetch = mockFetch;

      const statusChanges = [];
      await client.waitForPayment('pay_123', {
        interval: 10,
        onStatusChange: (status) => statusChanges.push(status),
      });

      expect(statusChanges).toEqual(['detected', 'confirmed']);
    });

    it('should timeout if payment does not complete', async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          payment: { id: 'pay_123', status: 'pending' },
        }),
      });
      global.fetch = mockFetch;

      await expect(
        client.waitForPayment('pay_123', { interval: 10, timeout: 50 })
      ).rejects.toThrow('timed out');
    });
  });

  describe('getPaymentQR', () => {
    let client;
    let mockFetch;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should fetch QR code as binary data', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });
      global.fetch = mockFetch;

      const result = await client.getPaymentQR('pay_abc123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/payments/pay_abc123/qr',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer cp_live_test_api_key_12345678',
          }),
        })
      );
      expect(result).toBe(mockArrayBuffer);
    });

    it('should throw error on non-ok response', async () => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      global.fetch = mockFetch;

      await expect(client.getPaymentQR('pay_invalid')).rejects.toThrow('HTTP 404');
    });
  });

  describe('createPayment', () => {
    let client;
    let mockFetch;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          payment: {
            id: 'pay_123',
            payment_address: '0x123',
            crypto_amount: '0.05',
            blockchain: 'ETH',
          },
        }),
      });
      global.fetch = mockFetch;
    });

    it('should send correct field names to API', async () => {
      await client.createPayment({
        businessId: 'biz_123',
        amount: 100,
        currency: 'USD',
        blockchain: 'ETH',
        description: 'Test payment',
        metadata: { orderId: '12345' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/payments/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            business_id: 'biz_123',
            amount: 100,
            currency: 'USD',
            blockchain: 'ETH',
            description: 'Test payment',
            metadata: { orderId: '12345' },
          }),
        })
      );
    });

    it('should default currency to USD', async () => {
      await client.createPayment({
        businessId: 'biz_123',
        amount: 100,
        blockchain: 'BTC',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/payments/create',
        expect.objectContaining({
          body: expect.stringContaining('"currency":"USD"'),
        })
      );
    });

    it('should uppercase blockchain value', async () => {
      await client.createPayment({
        businessId: 'biz_123',
        amount: 100,
        blockchain: 'eth',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/payments/create',
        expect.objectContaining({
          body: expect.stringContaining('"blockchain":"ETH"'),
        })
      );
    });
  });

  describe('exchange rate methods', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should have getExchangeRate method', () => {
      expect(typeof client.getExchangeRate).toBe('function');
    });

    it('should have getExchangeRates method', () => {
      expect(typeof client.getExchangeRates).toBe('function');
    });
  });

  describe('business methods', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should have getBusiness method', () => {
      expect(typeof client.getBusiness).toBe('function');
    });

    it('should have listBusinesses method', () => {
      expect(typeof client.listBusinesses).toBe('function');
    });

    it('should have createBusiness method', () => {
      expect(typeof client.createBusiness).toBe('function');
    });

    it('should have updateBusiness method', () => {
      expect(typeof client.updateBusiness).toBe('function');
    });
  });

  describe('webhook methods', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should have getWebhookLogs method', () => {
      expect(typeof client.getWebhookLogs).toBe('function');
    });

    it('should have testWebhook method', () => {
      expect(typeof client.testWebhook).toBe('function');
    });
  });

  describe('fiat conversion methods', () => {
    let client;
    let mockFetch;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });

      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should have convertFiatToCrypto method', () => {
      expect(typeof client.convertFiatToCrypto).toBe('function');
    });

    it('should convert fiat to crypto successfully', async () => {
      const mockResponse = {
        success: true,
        coin: 'SOL',
        rate: 148.37,
        fiat: 'USD',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.convertFiatToCrypto(50, 'USD', 'SOL');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/rates?coin=SOL&fiat=USD',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer cp_live_test_api_key_12345678',
            'Content-Type': 'application/json',
          }),
        })
      );

      expect(result).toEqual({
        cryptoAmount: 50 / 148.37,
        rate: 148.37,
        fiat: 'USD',
        crypto: 'SOL',
      });
    });

    it('should throw error when rate API fails', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid currency pair',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(client.convertFiatToCrypto(50, 'USD', 'INVALID'))
        .rejects.toThrow('Failed to get exchange rate for INVALID/USD');
    });

    it('should throw error when rate is missing', async () => {
      const mockResponse = {
        success: true,
        coin: 'SOL',
        fiat: 'USD',
        // rate is missing
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(client.convertFiatToCrypto(50, 'USD', 'SOL'))
        .rejects.toThrow('Failed to get exchange rate for SOL/USD');
    });
  });
});