/**
 * SDK Index Exports Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect } from 'vitest';
import * as sdk from '../src/index.js';
import { CoinPayClient } from '../src/client.js';
import { verifyWebhookSignature, WebhookEvent } from '../src/webhooks.js';

describe('@profullstack/coinpay SDK exports', () => {
  describe('named exports', () => {
    it('should export CoinPayClient', () => {
      expect(sdk.CoinPayClient).toBeDefined();
      expect(sdk.CoinPayClient).toBe(CoinPayClient);
    });

    it('should export verifyWebhookSignature', () => {
      expect(sdk.verifyWebhookSignature).toBeDefined();
      expect(sdk.verifyWebhookSignature).toBe(verifyWebhookSignature);
    });

    it('should export WebhookEvent', () => {
      expect(sdk.WebhookEvent).toBeDefined();
      expect(sdk.WebhookEvent).toBe(WebhookEvent);
    });

    it('should export createPayment function', () => {
      expect(sdk.createPayment).toBeDefined();
      expect(typeof sdk.createPayment).toBe('function');
    });

    it('should export getPayment function', () => {
      expect(sdk.getPayment).toBeDefined();
      expect(typeof sdk.getPayment).toBe('function');
    });

    it('should export listPayments function', () => {
      expect(sdk.listPayments).toBeDefined();
      expect(typeof sdk.listPayments).toBe('function');
    });
  });

  describe('default export', () => {
    it('should have CoinPayClient as default export', () => {
      expect(sdk.default).toBeDefined();
      expect(sdk.default).toBe(CoinPayClient);
    });
  });

  describe('CoinPayClient instantiation', () => {
    it('should create client with API key', () => {
      const client = new sdk.CoinPayClient({ apiKey: 'test_key' });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should create client with all options', () => {
      const client = new sdk.CoinPayClient({
        apiKey: 'test_key',
        baseUrl: 'https://custom.api.com',
        timeout: 60000,
      });
      expect(client).toBeInstanceOf(CoinPayClient);
    });
  });

  describe('WebhookEvent constants', () => {
    it('should have all payment events', () => {
      expect(sdk.WebhookEvent.PAYMENT_CREATED).toBe('payment.created');
      expect(sdk.WebhookEvent.PAYMENT_PENDING).toBe('payment.pending');
      expect(sdk.WebhookEvent.PAYMENT_CONFIRMING).toBe('payment.confirming');
      expect(sdk.WebhookEvent.PAYMENT_COMPLETED).toBe('payment.completed');
      expect(sdk.WebhookEvent.PAYMENT_EXPIRED).toBe('payment.expired');
      expect(sdk.WebhookEvent.PAYMENT_FAILED).toBe('payment.failed');
      expect(sdk.WebhookEvent.PAYMENT_REFUNDED).toBe('payment.refunded');
    });

    it('should have all business events', () => {
      expect(sdk.WebhookEvent.BUSINESS_CREATED).toBe('business.created');
      expect(sdk.WebhookEvent.BUSINESS_UPDATED).toBe('business.updated');
    });
  });
});