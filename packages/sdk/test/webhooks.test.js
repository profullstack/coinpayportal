/**
 * Webhook Utilities Tests
 * Testing Framework: Vitest
 */

import { describe, it, expect } from 'vitest';
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  generateWebhookSignature,
  WebhookEvent,
} from '../src/webhooks.js';

describe('Webhook Utilities', () => {
  const testSecret = 'whsec_test_secret_key_12345';
  const testPayload = JSON.stringify({
    id: 'evt_123',
    type: 'payment.completed',
    data: {
      paymentId: 'pay_abc123',
      amount: '0.001',
      currency: 'BTC',
    },
    created_at: '2024-01-15T10:30:00Z',
    business_id: 'biz_123',
  });

  describe('WebhookEvent constants', () => {
    it('should have PAYMENT_CREATED event', () => {
      expect(WebhookEvent.PAYMENT_CREATED).toBe('payment.created');
    });

    it('should have PAYMENT_PENDING event', () => {
      expect(WebhookEvent.PAYMENT_PENDING).toBe('payment.pending');
    });

    it('should have PAYMENT_CONFIRMING event', () => {
      expect(WebhookEvent.PAYMENT_CONFIRMING).toBe('payment.confirming');
    });

    it('should have PAYMENT_COMPLETED event', () => {
      expect(WebhookEvent.PAYMENT_COMPLETED).toBe('payment.completed');
    });

    it('should have PAYMENT_EXPIRED event', () => {
      expect(WebhookEvent.PAYMENT_EXPIRED).toBe('payment.expired');
    });

    it('should have PAYMENT_FAILED event', () => {
      expect(WebhookEvent.PAYMENT_FAILED).toBe('payment.failed');
    });

    it('should have PAYMENT_REFUNDED event', () => {
      expect(WebhookEvent.PAYMENT_REFUNDED).toBe('payment.refunded');
    });

    it('should have BUSINESS_CREATED event', () => {
      expect(WebhookEvent.BUSINESS_CREATED).toBe('business.created');
    });

    it('should have BUSINESS_UPDATED event', () => {
      expect(WebhookEvent.BUSINESS_UPDATED).toBe('business.updated');
    });
  });

  describe('generateWebhookSignature', () => {
    it('should generate a valid signature', () => {
      const signature = generateWebhookSignature({
        payload: testPayload,
        secret: testSecret,
      });

      expect(typeof signature).toBe('string');
      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
    });

    it('should include timestamp in signature', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature({
        payload: testPayload,
        secret: testSecret,
        timestamp,
      });

      expect(signature).toContain(`t=${timestamp}`);
    });

    it('should generate different signatures for different payloads', () => {
      const sig1 = generateWebhookSignature({
        payload: testPayload,
        secret: testSecret,
        timestamp: 1000000,
      });

      const sig2 = generateWebhookSignature({
        payload: '{"different": "payload"}',
        secret: testSecret,
        timestamp: 1000000,
      });

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const sig1 = generateWebhookSignature({
        payload: testPayload,
        secret: testSecret,
        timestamp: 1000000,
      });

      const sig2 = generateWebhookSignature({
        payload: testPayload,
        secret: 'different_secret',
        timestamp: 1000000,
      });

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify a valid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = generateWebhookSignature({
        payload: testPayload,
        secret: testSecret,
        timestamp,
      });

      const isValid = verifyWebhookSignature({
        payload: testPayload,
        signature,
        secret: testSecret,
      });

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const isValid = verifyWebhookSignature({
        payload: testPayload,
        signature: 't=1234567890,v1=invalidsignature',
        secret: testSecret,
      });

      expect(isValid).toBe(false);
    });

    it('should reject expired signature', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const signature = generateWebhookSignature({
        payload: testPayload,
        secret: testSecret,
        timestamp: oldTimestamp,
      });

      const isValid = verifyWebhookSignature({
        payload: testPayload,
        signature,
        secret: testSecret,
        tolerance: 300, // 5 minutes
      });

      expect(isValid).toBe(false);
    });

    it('should accept signature within tolerance', () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
      const signature = generateWebhookSignature({
        payload: testPayload,
        secret: testSecret,
        timestamp: recentTimestamp,
      });

      const isValid = verifyWebhookSignature({
        payload: testPayload,
        signature,
        secret: testSecret,
        tolerance: 300, // 5 minutes
      });

      expect(isValid).toBe(true);
    });

    it('should throw error when payload is missing', () => {
      expect(() =>
        verifyWebhookSignature({
          signature: 't=123,v1=abc',
          secret: testSecret,
        })
      ).toThrow('Missing required parameters');
    });

    it('should throw error when signature is missing', () => {
      expect(() =>
        verifyWebhookSignature({
          payload: testPayload,
          secret: testSecret,
        })
      ).toThrow('Missing required parameters');
    });

    it('should throw error when secret is missing', () => {
      expect(() =>
        verifyWebhookSignature({
          payload: testPayload,
          signature: 't=123,v1=abc',
        })
      ).toThrow('Missing required parameters');
    });

    it('should return false for malformed signature', () => {
      const isValid = verifyWebhookSignature({
        payload: testPayload,
        signature: 'malformed-signature',
        secret: testSecret,
      });

      expect(isValid).toBe(false);
    });

    it('should return false for signature without timestamp', () => {
      const isValid = verifyWebhookSignature({
        payload: testPayload,
        signature: 'v1=abc123',
        secret: testSecret,
      });

      expect(isValid).toBe(false);
    });

    it('should return false for signature without v1', () => {
      const isValid = verifyWebhookSignature({
        payload: testPayload,
        signature: 't=1234567890',
        secret: testSecret,
      });

      expect(isValid).toBe(false);
    });
  });

  describe('parseWebhookPayload', () => {
    it('should parse valid JSON payload', () => {
      const event = parseWebhookPayload(testPayload);

      expect(event.id).toBe('evt_123');
      expect(event.type).toBe('payment.completed');
      expect(event.data).toBeDefined();
      expect(event.businessId).toBe('biz_123');
      expect(event.createdAt).toBeInstanceOf(Date);
    });

    it('should parse payment data correctly', () => {
      const event = parseWebhookPayload(testPayload);

      expect(event.data).toEqual({
        paymentId: 'pay_abc123',
        amount: '0.001',
        currency: 'BTC',
      });
    });

    it('should throw error for invalid JSON', () => {
      expect(() => parseWebhookPayload('invalid json')).toThrow(
        'Failed to parse webhook payload'
      );
    });

    it('should throw error for empty payload', () => {
      expect(() => parseWebhookPayload('')).toThrow(
        'Failed to parse webhook payload'
      );
    });
  });
});