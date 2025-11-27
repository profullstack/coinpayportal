/**
 * Webhook utilities for CoinPay SDK
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Webhook event types
 */
export const WebhookEvent = {
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_PENDING: 'payment.pending',
  PAYMENT_CONFIRMING: 'payment.confirming',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_EXPIRED: 'payment.expired',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  BUSINESS_CREATED: 'business.created',
  BUSINESS_UPDATED: 'business.updated',
};

/**
 * Verify webhook signature
 * @param {Object} params - Verification parameters
 * @param {string} params.payload - Raw request body (string)
 * @param {string} params.signature - Signature from X-CoinPay-Signature header
 * @param {string} params.secret - Your webhook secret
 * @param {number} [params.tolerance] - Timestamp tolerance in seconds (default: 300)
 * @returns {boolean} True if signature is valid
 */
export function verifyWebhookSignature({
  payload,
  signature,
  secret,
  tolerance = 300,
}) {
  if (!payload || !signature || !secret) {
    throw new Error('Missing required parameters: payload, signature, and secret are required');
  }

  try {
    // Parse signature header (format: t=timestamp,v1=signature)
    const parts = signature.split(',');
    const signatureParts = {};
    
    for (const part of parts) {
      const [key, value] = part.split('=');
      signatureParts[key] = value;
    }

    const timestamp = signatureParts.t;
    const expectedSignature = signatureParts.v1;

    if (!timestamp || !expectedSignature) {
      return false;
    }

    // Check timestamp tolerance
    const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
    if (Math.abs(timestampAge) > tolerance) {
      return false;
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const computedSignature = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Timing-safe comparison
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const computedBuffer = Buffer.from(computedSignature, 'hex');

    if (expectedBuffer.length !== computedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, computedBuffer);
  } catch (error) {
    return false;
  }
}

/**
 * Parse webhook payload
 * @param {string} payload - Raw request body
 * @returns {Object} Parsed webhook event
 */
export function parseWebhookPayload(payload) {
  try {
    const event = JSON.parse(payload);
    
    return {
      id: event.id,
      type: event.type,
      data: event.data,
      createdAt: new Date(event.created_at),
      businessId: event.business_id,
    };
  } catch (error) {
    throw new Error(`Failed to parse webhook payload: ${error.message}`);
  }
}

/**
 * Create a webhook handler middleware for Express/Connect
 * @param {Object} options - Handler options
 * @param {string} options.secret - Webhook secret
 * @param {Function} options.onEvent - Event handler function
 * @param {Function} [options.onError] - Error handler function
 * @returns {Function} Express middleware
 */
export function createWebhookHandler({ secret, onEvent, onError }) {
  return async (req, res) => {
    try {
      const signature = req.headers['x-coinpay-signature'];
      const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

      // Verify signature
      const isValid = verifyWebhookSignature({
        payload,
        signature,
        secret,
      });

      if (!isValid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // Parse and handle event
      const event = parseWebhookPayload(payload);
      await onEvent(event);

      res.status(200).json({ received: true });
    } catch (error) {
      if (onError) {
        onError(error);
      }
      res.status(500).json({ error: 'Webhook handler error' });
    }
  };
}

/**
 * Generate a webhook signature (for testing)
 * @param {Object} params - Signature parameters
 * @param {string} params.payload - Request body
 * @param {string} params.secret - Webhook secret
 * @param {number} [params.timestamp] - Unix timestamp (default: now)
 * @returns {string} Signature header value
 */
export function generateWebhookSignature({ payload, secret, timestamp }) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${payload}`;
  const signature = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return `t=${ts},v1=${signature}`;
}

export default {
  WebhookEvent,
  verifyWebhookSignature,
  parseWebhookPayload,
  createWebhookHandler,
  generateWebhookSignature,
};