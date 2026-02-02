/**
 * @profullstack/coinpay - CoinPay SDK
 * Cryptocurrency payment integration for Node.js
 *
 * @module @profullstack/coinpay
 */

export { CoinPayClient } from './client.js';
export type { CoinPayClientOptions, PaymentParams, ListPaymentsParams, WaitForPaymentOptions, CreateBusinessParams } from './client.js';

export {
  createPayment,
  getPayment,
  listPayments,
  Blockchain,
  Cryptocurrency,
  PaymentStatus,
  FiatCurrency,
} from './payments.js';
export type { CreatePaymentParams, GetPaymentParams, ListPaymentsFnParams } from './payments.js';

export {
  verifyWebhookSignature,
  generateWebhookSignature,
  parseWebhookPayload,
  createWebhookHandler,
  WebhookEvent,
} from './webhooks.js';
export type {
  VerifyWebhookParams,
  GenerateWebhookParams,
  WebhookHandlerOptions,
  ParsedWebhookEvent,
} from './webhooks.js';

import { CoinPayClient } from './client.js';
export default CoinPayClient;
