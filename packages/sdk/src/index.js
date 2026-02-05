/**
 * CoinPay SDK
 * Cryptocurrency payment integration for Node.js
 *
 * @module @profullstack/coinpay
 *
 * @example
 * // Quick start
 * import { CoinPayClient, Blockchain } from '@profullstack/coinpay';
 *
 * const client = new CoinPayClient({ apiKey: 'cp_live_xxxxx' });
 *
 * const payment = await client.createPayment({
 *   businessId: 'your-business-id',
 *   amount: 100,
 *   blockchain: Blockchain.BTC,
 *   description: 'Order #12345'
 * });
 */

import { CoinPayClient } from './client.js';
import {
  createPayment,
  getPayment,
  listPayments,
  Blockchain,
  Cryptocurrency,
  PaymentStatus,
  FiatCurrency,
} from './payments.js';
import {
  verifyWebhookSignature,
  generateWebhookSignature,
  parseWebhookPayload,
  createWebhookHandler,
  WebhookEvent,
} from './webhooks.js';

import {
  createEscrow,
  getEscrow,
  listEscrows,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
  getEscrowEvents,
  waitForEscrow,
} from './escrow.js';

export {
  // Client
  CoinPayClient,
  
  // Payment functions
  createPayment,
  getPayment,
  listPayments,
  
  // Escrow functions
  createEscrow,
  getEscrow,
  listEscrows,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
  getEscrowEvents,
  waitForEscrow,
  
  // Constants
  Blockchain,
  Cryptocurrency,  // Deprecated, use Blockchain
  PaymentStatus,
  FiatCurrency,
  
  // Webhook utilities
  verifyWebhookSignature,
  generateWebhookSignature,
  parseWebhookPayload,
  createWebhookHandler,
  WebhookEvent,
};

export default CoinPayClient;