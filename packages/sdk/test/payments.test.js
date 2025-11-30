/**
 * Payments Module Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createPayment,
  getPayment,
  listPayments,
  Blockchain,
  Cryptocurrency,
  PaymentStatus,
  FiatCurrency,
} from '../src/payments.js';
import { CoinPayClient } from '../src/client.js';

describe('Payments Module', () => {
  describe('Blockchain constants', () => {
    it('should have all native blockchain types', () => {
      expect(Blockchain.BTC).toBe('BTC');
      expect(Blockchain.BCH).toBe('BCH');
      expect(Blockchain.ETH).toBe('ETH');
      expect(Blockchain.POL).toBe('POL');
      expect(Blockchain.SOL).toBe('SOL');
    });

    it('should have all USDC variants', () => {
      expect(Blockchain.USDC_ETH).toBe('USDC_ETH');
      expect(Blockchain.USDC_POL).toBe('USDC_POL');
      expect(Blockchain.USDC_SOL).toBe('USDC_SOL');
    });

    it('should have 8 total blockchain types', () => {
      expect(Object.keys(Blockchain)).toHaveLength(8);
    });
  });

  describe('Cryptocurrency (deprecated alias)', () => {
    it('should be the same as Blockchain', () => {
      expect(Cryptocurrency).toBe(Blockchain);
    });
  });

  describe('PaymentStatus constants', () => {
    it('should have all payment statuses', () => {
      expect(PaymentStatus.PENDING).toBe('pending');
      expect(PaymentStatus.CONFIRMING).toBe('confirming');
      expect(PaymentStatus.COMPLETED).toBe('completed');
      expect(PaymentStatus.EXPIRED).toBe('expired');
      expect(PaymentStatus.FAILED).toBe('failed');
      expect(PaymentStatus.REFUNDED).toBe('refunded');
    });
  });

  describe('FiatCurrency constants', () => {
    it('should have common fiat currencies', () => {
      expect(FiatCurrency.USD).toBe('USD');
      expect(FiatCurrency.EUR).toBe('EUR');
      expect(FiatCurrency.GBP).toBe('GBP');
      expect(FiatCurrency.CAD).toBe('CAD');
      expect(FiatCurrency.AUD).toBe('AUD');
    });
  });

  describe('createPayment function', () => {
    let mockFetch;

    beforeEach(() => {
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

    it('should create payment with API key', async () => {
      const result = await createPayment({
        apiKey: 'cp_live_test_api_key_12345678',
        businessId: 'biz_123',
        amount: 100,
        blockchain: 'ETH',
      });

      expect(result.success).toBe(true);
      expect(result.payment.id).toBe('pay_123');
    });

    it('should create payment with existing client', async () => {
      const client = new CoinPayClient({
        apiKey: 'cp_live_test_api_key_12345678',
        baseUrl: 'https://api.test.com',
      });

      const result = await createPayment({
        client,
        businessId: 'biz_123',
        amount: 100,
        blockchain: 'BTC',
      });

      expect(result.success).toBe(true);
    });

    it('should default currency to USD', async () => {
      await createPayment({
        apiKey: 'cp_live_test_api_key_12345678',
        businessId: 'biz_123',
        amount: 100,
        blockchain: 'ETH',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"currency":"USD"'),
        })
      );
    });

    it('should pass metadata correctly', async () => {
      await createPayment({
        apiKey: 'cp_live_test_api_key_12345678',
        businessId: 'biz_123',
        amount: 100,
        blockchain: 'ETH',
        metadata: { orderId: '12345' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"metadata":{"orderId":"12345"}'),
        })
      );
    });

    it('should pass description correctly', async () => {
      await createPayment({
        apiKey: 'cp_live_test_api_key_12345678',
        businessId: 'biz_123',
        amount: 100,
        blockchain: 'ETH',
        description: 'Test payment',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"description":"Test payment"'),
        })
      );
    });
  });

  describe('getPayment function', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          payment: {
            id: 'pay_123',
            status: 'confirmed',
          },
        }),
      });
      global.fetch = mockFetch;
    });

    it('should get payment by ID', async () => {
      const result = await getPayment({
        apiKey: 'cp_live_test_api_key_12345678',
        paymentId: 'pay_123',
      });

      expect(result.success).toBe(true);
      expect(result.payment.id).toBe('pay_123');
    });
  });

  describe('listPayments function', () => {
    let mockFetch;

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          payments: [
            { id: 'pay_1', status: 'completed' },
            { id: 'pay_2', status: 'pending' },
          ],
        }),
      });
      global.fetch = mockFetch;
    });

    it('should list payments for a business', async () => {
      const result = await listPayments({
        apiKey: 'cp_live_test_api_key_12345678',
        businessId: 'biz_123',
      });

      expect(result.success).toBe(true);
      expect(result.payments).toHaveLength(2);
    });

    it('should pass status filter', async () => {
      await listPayments({
        apiKey: 'cp_live_test_api_key_12345678',
        businessId: 'biz_123',
        status: 'completed',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=completed'),
        expect.any(Object)
      );
    });

    it('should pass limit parameter', async () => {
      await listPayments({
        apiKey: 'cp_live_test_api_key_12345678',
        businessId: 'biz_123',
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
    });
  });
});