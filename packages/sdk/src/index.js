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
 *
 * @example
 * // Wallet usage
 * import { WalletClient } from '@profullstack/coinpay';
 *
 * // Create a new wallet
 * const wallet = await WalletClient.create({ words: 12, chains: ['BTC', 'ETH'] });
 * console.log('Backup your seed:', wallet.getMnemonic());
 *
 * // Or import existing
 * const wallet = await WalletClient.fromSeed('your twelve word mnemonic phrase ...');
 *
 * @example
 * // Swap usage
 * import { SwapClient } from '@profullstack/coinpay';
 *
 * const swap = new SwapClient({ walletId: 'your-wallet-id' });
 * const quote = await swap.getSwapQuote('BTC', 'ETH', 0.1);
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
  authenticateEscrow,
} from './escrow.js';

// Wallet exports
import {
  WalletClient,
  WalletChain,
  DEFAULT_CHAINS,
  generateMnemonic,
  validateMnemonic,
  getDerivationPath,
  restoreFromBackup,
} from './wallet.js';

// Swap exports
// Reputation exports
import {
  submitReceipt,
  getReputation,
  getCredential,
  getCredentials,
  getReceipts,
  getBadgeUrl,
  verifyCredential,
  getRevocationList,
  claimDid,
  linkDid,
  getMyDid,
} from './reputation.js';

// Auth exports
import {
  registerMerchant,
  loginMerchant,
  getMe,
} from './auth.js';

import {
  SwapClient,
  SwapCoins,
  SwapStatus,
  getSwapCoins,
  getSwapQuote,
  createSwap,
  getSwapStatus,
  getSwapHistory,
} from './swap.js';

// Payouts
import {
  createPayout,
  listPayouts,
  getPayout,
  formatPayoutAmount,
} from './payouts.js';

// Card payments
import {
  createQuickCardPayment,
  waitForStripeOnboarding,
  createCardPaymentWithOnboardingCheck,
  getPaymentMethodSupport,
  formatCardAmount,
  calculateCardPaymentFees,
  createCardEscrow,
  listCardEscrows,
  releaseCardEscrow,
  refundCardEscrow,
  getCardEscrowStatus,
} from './card-payments.js';

// Subscriptions
import {
  createSubscriptionPlan,
  listSubscriptionPlans,
  subscribeCustomer,
  cancelSubscription,
  listSubscriptions,
  getSubscription,
  formatSubscriptionAmount,
  PlanInterval,
  SubscriptionStatus,
} from './subscriptions.js';

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
  authenticateEscrow,
  
  // Wallet
  WalletClient,
  WalletChain,
  DEFAULT_CHAINS,
  generateMnemonic,
  validateMnemonic,
  getDerivationPath,
  restoreFromBackup,
  
  // Swap
  SwapClient,
  SwapCoins,
  SwapStatus,
  getSwapCoins,
  getSwapQuote,
  createSwap,
  getSwapStatus,
  getSwapHistory,
  
  // Payouts
  createPayout,
  listPayouts,
  getPayout,
  formatPayoutAmount,
  
  // Card payments
  createQuickCardPayment,
  waitForStripeOnboarding,
  createCardPaymentWithOnboardingCheck,
  getPaymentMethodSupport,
  formatCardAmount,
  calculateCardPaymentFees,
  createCardEscrow,
  listCardEscrows,
  releaseCardEscrow,
  refundCardEscrow,
  getCardEscrowStatus,
  
  // Subscriptions
  createSubscriptionPlan,
  listSubscriptionPlans,
  subscribeCustomer,
  cancelSubscription,
  listSubscriptions,
  getSubscription,
  formatSubscriptionAmount,
  PlanInterval,
  SubscriptionStatus,
  
  // Constants
  Blockchain,
  Cryptocurrency,  // Deprecated, use Blockchain
  PaymentStatus,
  FiatCurrency,
  
  // Reputation
  submitReceipt,
  getReputation,
  getCredential,
  getCredentials,
  getReceipts,
  getBadgeUrl,
  verifyCredential,
  getRevocationList,
  claimDid,
  linkDid,
  getMyDid,
  
  // Auth
  registerMerchant,
  loginMerchant,
  getMe,
  
  // Webhook utilities
  verifyWebhookSignature,
  generateWebhookSignature,
  parseWebhookPayload,
  createWebhookHandler,
  WebhookEvent,
};

export default CoinPayClient;
