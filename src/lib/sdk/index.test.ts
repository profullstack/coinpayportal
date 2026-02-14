/**
 * SDK Integration Tests
 *
 * Tests for the @profullstack/coinpay SDK integration module.
 * Uses Vitest as the testing framework.
 *
 * These tests verify that the SDK is properly integrated and
 * the wrapper functions work correctly with the actual SDK.
 */

import { describe, it, expect } from 'vitest';
import {
  CoinPayClient,
  verifyWebhookSignature,
  generateWebhookSignature,
  WebhookEvent,
  createCoinPayClient,
  verifyIncomingWebhook,
  generateTestWebhookSignature,
} from './index';

describe('SDK Integration Module', () => {
  describe('SDK exports', () => {
    it('should export CoinPayClient class', () => {
      expect(CoinPayClient).toBeDefined();
      expect(typeof CoinPayClient).toBe('function');
    });

    it('should export verifyWebhookSignature function', () => {
      expect(verifyWebhookSignature).toBeDefined();
      expect(typeof verifyWebhookSignature).toBe('function');
    });

    it('should export generateWebhookSignature function', () => {
      expect(generateWebhookSignature).toBeDefined();
      expect(typeof generateWebhookSignature).toBe('function');
    });

    it('should export WebhookEvent constants', () => {
      expect(WebhookEvent).toBeDefined();
      // Use the actual event names from the SDK
      expect(WebhookEvent.PAYMENT_CREATED).toBe('payment.created');
      expect(WebhookEvent.PAYMENT_PENDING).toBe('payment.pending');
      expect(WebhookEvent.PAYMENT_CONFIRMING).toBe('payment.confirming');
      expect(WebhookEvent.PAYMENT_COMPLETED).toBe('payment.completed');
      expect(WebhookEvent.PAYMENT_EXPIRED).toBe('payment.expired');
      expect(WebhookEvent.PAYMENT_FAILED).toBe('payment.failed');
    });

    it('should export createCoinPayClient helper', () => {
      expect(createCoinPayClient).toBeDefined();
      expect(typeof createCoinPayClient).toBe('function');
    });

    it('should export verifyIncomingWebhook helper', () => {
      expect(verifyIncomingWebhook).toBeDefined();
      expect(typeof verifyIncomingWebhook).toBe('function');
    });

    it('should export generateTestWebhookSignature helper', () => {
      expect(generateTestWebhookSignature).toBeDefined();
      expect(typeof generateTestWebhookSignature).toBe('function');
    });
  });

  describe('createCoinPayClient', () => {
    it('should create a CoinPayClient instance', () => {
      const client = createCoinPayClient('test-api-key');
      expect(client).toBeDefined();
      // Check it has the expected methods instead of instanceof
      expect(typeof client.createPayment).toBe('function');
      expect(typeof client.getPayment).toBe('function');
    });

    it('should create client with custom base URL', () => {
      const client = createCoinPayClient(
        'test-api-key',
        'https://custom-api.example.com'
      );
      expect(client).toBeDefined();
      expect(typeof client.createPayment).toBe('function');
    });

    it('should have payment methods', () => {
      const client = createCoinPayClient('test-api-key');
      expect(typeof client.createPayment).toBe('function');
      expect(typeof client.getPayment).toBe('function');
      expect(typeof client.listPayments).toBe('function');
    });

    it('should have business methods', () => {
      const client = createCoinPayClient('test-api-key');
      expect(typeof client.createBusiness).toBe('function');
      expect(typeof client.getBusiness).toBe('function');
      expect(typeof client.listBusinesses).toBe('function');
    });

    it('should have rate methods', () => {
      const client = createCoinPayClient('test-api-key');
      expect(typeof client.getExchangeRate).toBe('function');
      expect(typeof client.getExchangeRates).toBe('function');
    });
  });

  describe('verifyIncomingWebhook', () => {
    const testSecret = 'test-webhook-secret-12345';

    it('should verify valid webhook signature', () => {
      const payload = JSON.stringify({
        type: 'payment.completed',
        id: 'evt_123',
        data: { payment_id: 'pay_123' },
        created_at: '2024-01-01T00:00:00Z',
        business_id: 'biz_456',
      });

      // Generate a valid signature using the SDK's function
      const signature = generateTestWebhookSignature(payload, testSecret);
      const result = verifyIncomingWebhook(payload, signature, testSecret);

      expect(result).toBe(true);
    });

    it('should reject invalid webhook signature', () => {
      const payload = JSON.stringify({
        type: 'payment.completed',
        id: 'evt_123',
      });

      const invalidSignature = 't=1234567890,v1=invalid-signature';
      const result = verifyIncomingWebhook(payload, invalidSignature, testSecret);

      expect(result).toBe(false);
    });

    it('should reject tampered payload', () => {
      const originalPayload = JSON.stringify({
        type: 'payment.completed',
        id: 'evt_123',
        data: { amount: '100.00' },
      });

      const signature = generateTestWebhookSignature(originalPayload, testSecret);

      // Tamper with the payload
      const tamperedPayload = JSON.stringify({
        type: 'payment.completed',
        id: 'evt_123',
        data: { amount: '1000.00' }, // Changed amount
      });

      const result = verifyIncomingWebhook(tamperedPayload, signature, testSecret);

      expect(result).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const payload = JSON.stringify({
        type: 'payment.completed',
        id: 'evt_123',
      });

      const signatureWithDifferentSecret = generateTestWebhookSignature(
        payload,
        'different-secret'
      );
      const result = verifyIncomingWebhook(
        payload,
        signatureWithDifferentSecret,
        testSecret
      );

      expect(result).toBe(false);
    });

    it('should reject expired signatures', () => {
      const payload = JSON.stringify({
        type: 'payment.completed',
        id: 'evt_123',
      });

      // Generate signature with old timestamp (10 minutes ago)
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signature = generateTestWebhookSignature(payload, testSecret, oldTimestamp);

      // Use a short tolerance (60 seconds)
      const result = verifyIncomingWebhook(payload, signature, testSecret, 60);

      expect(result).toBe(false);
    });
  });

  describe('generateTestWebhookSignature', () => {
    it('should generate signature in correct format', () => {
      const payload = JSON.stringify({ type: 'test' });
      const signature = generateTestWebhookSignature(payload, 'secret');

      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
    });

    it('should use provided timestamp', () => {
      const payload = JSON.stringify({ type: 'test' });
      const timestamp = 1234567890;
      const signature = generateTestWebhookSignature(payload, 'secret', timestamp);

      expect(signature).toContain('t=1234567890');
    });

    it('should generate different signatures for different payloads', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const sig1 = generateTestWebhookSignature('{"a":1}', 'secret', timestamp);
      const sig2 = generateTestWebhookSignature('{"a":2}', 'secret', timestamp);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const payload = JSON.stringify({ type: 'test' });
      const timestamp = Math.floor(Date.now() / 1000);
      const sig1 = generateTestWebhookSignature(payload, 'secret1', timestamp);
      const sig2 = generateTestWebhookSignature(payload, 'secret2', timestamp);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('CoinPayClient direct usage', () => {
    it('should instantiate with options object', () => {
      const client = new CoinPayClient({
        apiKey: 'direct-api-key',
        baseUrl: 'https://api.example.com',
      });

      expect(client).toBeDefined();
      expect(typeof client.createPayment).toBe('function');
    });

    it('should allow creation without API key (for auth operations)', () => {
      const client = new CoinPayClient({} as any);
      expect(client).toBeInstanceOf(CoinPayClient);
    });
  });

  describe('verifyWebhookSignature direct usage', () => {
    it('should work with named parameters', () => {
      const payload = JSON.stringify({ type: 'payment.completed' });
      const secret = 'test-secret';
      const signature = generateWebhookSignature({ payload, secret });

      const result = verifyWebhookSignature({ payload, signature, secret });

      expect(result).toBe(true);
    });

    it('should throw error with missing parameters', () => {
      expect(() => {
        verifyWebhookSignature({} as any);
      }).toThrow('Missing required parameters');
    });
  });

  describe('Type definitions', () => {
    it('should have CoinPayClientOptions type', () => {
      const options: import('./index').CoinPayClientOptions = {
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
      };
      expect(options.apiKey).toBe('test-key');
    });

    it('should have CreatePaymentParams type', () => {
      const params: import('./index').CreatePaymentParams = {
        businessId: 'biz_123',
        amount: 100,
        currency: 'USD',
        cryptocurrency: 'BTC',
        metadata: { orderId: 'order_456' },
      };
      expect(params.businessId).toBe('biz_123');
    });

    it('should have PaymentResponse type', () => {
      const response: import('./index').PaymentResponse = {
        id: 'pay_123',
        business_id: 'biz_456',
        amount_usd: '100.00',
        amount_crypto: '0.0025',
        currency: 'USD',
        cryptocurrency: 'BTC',
        wallet_address: 'bc1q...',
        status: 'pending',
        expires_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      };
      expect(response.id).toBe('pay_123');
    });

    it('should have WebhookPayload type', () => {
      const payload: import('./index').WebhookPayload = {
        id: 'evt_123',
        type: 'payment.completed',
        data: { payment_id: 'pay_123' },
        created_at: '2024-01-01T00:00:00Z',
        business_id: 'biz_456',
      };
      expect(payload.type).toBe('payment.completed');
    });

    it('should have VerifyWebhookParams type', () => {
      const params: import('./index').VerifyWebhookParams = {
        payload: '{"type":"test"}',
        signature: 't=123,v1=abc',
        secret: 'secret',
        tolerance: 300,
      };
      expect(params.payload).toBe('{"type":"test"}');
    });
  });
});