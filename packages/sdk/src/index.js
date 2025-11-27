/**
 * CoinPay SDK
 * Cryptocurrency payment integration for Node.js
 *
 * @module @profullstack/coinpay
 */

import { CoinPayClient } from './client.js';
import { createPayment, getPayment, listPayments } from './payments.js';
import {
  verifyWebhookSignature,
  generateWebhookSignature,
  parseWebhookPayload,
  createWebhookHandler,
  WebhookEvent,
} from './webhooks.js';

export {
  CoinPayClient,
  createPayment,
  getPayment,
  listPayments,
  verifyWebhookSignature,
  generateWebhookSignature,
  parseWebhookPayload,
  createWebhookHandler,
  WebhookEvent,
};

export default CoinPayClient;