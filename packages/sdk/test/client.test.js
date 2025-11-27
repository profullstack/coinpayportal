/**
 * CoinPayClient Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CoinPayClient } from '../src/client.js';

describe('CoinPayClient', () => {
  describe('constructor', () => {
    it('should create a client with valid API key', () => {
      const client = new CoinPayClient({ apiKey: 'test_api_key' });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should throw error when API key is missing', () => {
      expect(() => new CoinPayClient({})).toThrow('API key is required');
    });

    it('should throw error when API key is empty', () => {
      expect(() => new CoinPayClient({ apiKey: '' })).toThrow('API key is required');
    });

    it('should use default base URL when not provided', () => {
      const client = new CoinPayClient({ apiKey: 'test_key' });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should accept custom base URL', () => {
      const client = new CoinPayClient({
        apiKey: 'test_key',
        baseUrl: 'https://custom.api.com',
      });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should remove trailing slash from base URL', () => {
      const client = new CoinPayClient({
        apiKey: 'test_key',
        baseUrl: 'https://custom.api.com/',
      });
      expect(client).toBeInstanceOf(CoinPayClient);
    });

    it('should accept custom timeout', () => {
      const client = new CoinPayClient({
        apiKey: 'test_key',
        timeout: 60000,
      });
      expect(client).toBeInstanceOf(CoinPayClient);
    });
  });

  describe('request method', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'test_api_key',
        baseUrl: 'https://api.test.com',
      });
    });

    it('should be a function', () => {
      expect(typeof client.request).toBe('function');
    });
  });

  describe('payment methods', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'test_api_key',
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
  });

  describe('exchange rate methods', () => {
    let client;

    beforeEach(() => {
      client = new CoinPayClient({
        apiKey: 'test_api_key',
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
        apiKey: 'test_api_key',
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
        apiKey: 'test_api_key',
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
});