/**
 * SDK Index Exports Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect } from 'vitest';
import * as sdk from '../src/index.js';
import { CoinPayClient } from '../src/client.js';
import { verifyWebhookSignature, WebhookEvent } from '../src/webhooks.js';
import { Blockchain, PaymentStatus, FiatCurrency } from '../src/payments.js';

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

    it('should export Blockchain constants', () => {
      expect(sdk.Blockchain).toBeDefined();
      expect(sdk.Blockchain).toBe(Blockchain);
    });

    it('should export PaymentStatus constants', () => {
      expect(sdk.PaymentStatus).toBeDefined();
      expect(sdk.PaymentStatus).toBe(PaymentStatus);
    });

    it('should export FiatCurrency constants', () => {
      expect(sdk.FiatCurrency).toBeDefined();
      expect(sdk.FiatCurrency).toBe(FiatCurrency);
    });

    it('should export Cryptocurrency as deprecated alias for Blockchain', () => {
      expect(sdk.Cryptocurrency).toBeDefined();
      expect(sdk.Cryptocurrency).toBe(sdk.Blockchain);
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
      const client = new sdk.CoinPayClient({ apiKey: 'cp_live_test_key_123456789' });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should create client with all options', () => {
      const client = new sdk.CoinPayClient({
        apiKey: 'cp_live_test_key_123456789',
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

  describe('Blockchain constants', () => {
    it('should have all native blockchain types', () => {
      expect(sdk.Blockchain.BTC).toBe('BTC');
      expect(sdk.Blockchain.BCH).toBe('BCH');
      expect(sdk.Blockchain.ETH).toBe('ETH');
      expect(sdk.Blockchain.POL).toBe('POL');
      expect(sdk.Blockchain.SOL).toBe('SOL');
    });

    it('should have all USDC variants', () => {
      expect(sdk.Blockchain.USDC_ETH).toBe('USDC_ETH');
      expect(sdk.Blockchain.USDC_POL).toBe('USDC_POL');
      expect(sdk.Blockchain.USDC_SOL).toBe('USDC_SOL');
    });
  });

  describe('PaymentStatus constants', () => {
    it('should have all payment statuses', () => {
      expect(sdk.PaymentStatus.PENDING).toBe('pending');
      expect(sdk.PaymentStatus.CONFIRMING).toBe('confirming');
      expect(sdk.PaymentStatus.COMPLETED).toBe('completed');
      expect(sdk.PaymentStatus.EXPIRED).toBe('expired');
      expect(sdk.PaymentStatus.FAILED).toBe('failed');
      expect(sdk.PaymentStatus.REFUNDED).toBe('refunded');
    });
  });

  describe('FiatCurrency constants', () => {
    it('should have common fiat currencies', () => {
      expect(sdk.FiatCurrency.USD).toBe('USD');
      expect(sdk.FiatCurrency.EUR).toBe('EUR');
      expect(sdk.FiatCurrency.GBP).toBe('GBP');
    });
  });
});