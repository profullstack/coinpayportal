/**
 * @profullstack/coinpay - CoinPay SDK
 * Cryptocurrency payment integration for Node.js
 *
 * @module @profullstack/coinpay
 */

// Client exports
export { CoinPayClient } from './client.js';
export type { 
  CoinPayClientOptions, 
  PaymentParams, 
  ListPaymentsParams, 
  WaitForPaymentOptions, 
  CreateBusinessParams 
} from './client.js';

// Payment exports
export {
  createPayment,
  getPayment,
  listPayments,
  Blockchain,
  Cryptocurrency,
  PaymentStatus,
  FiatCurrency,
} from './payments.js';
export type { 
  CreatePaymentParams, 
  GetPaymentParams, 
  ListPaymentsFnParams 
} from './payments.js';

// Webhook exports
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

// Wallet exports
export {
  WalletClient,
  WalletChain,
  DEFAULT_CHAINS,
  generateMnemonic,
  validateMnemonic,
  getDerivationPath,
  restoreFromBackup,
} from './wallet.js';
export type {
  WalletChainType,
  WalletCreateOptions,
  WalletImportOptions,
  WalletAddress,
  AddressListResult,
  WalletBalance,
  SendOptions,
  HistoryOptions,
  Transaction,
  FeeEstimate,
} from './wallet.js';

// Swap exports
export {
  SwapClient,
  SwapCoins,
  SwapStatus,
  getSwapCoins,
  getSwapQuote,
  createSwap,
  getSwapStatus,
  getSwapHistory,
} from './swap.js';
export type {
  SwapStatusType,
  SwapClientOptions,
  CoinInfo,
  CoinsResult,
  SwapQuote,
  QuoteResult,
  CreateSwapParams,
  Swap,
  SwapResult,
  WaitForSwapOptions,
  SwapHistoryOptions,
  SwapHistoryPagination,
  SwapHistoryResult,
} from './swap.js';

import { CoinPayClient } from './client.js';
export default CoinPayClient;
