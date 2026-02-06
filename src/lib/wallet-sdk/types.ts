/**
 * Wallet SDK Type Definitions
 *
 * Re-exports chain/fee/signing types from the web-wallet modules
 * and defines SDK-specific types for the public API.
 */

import type { WalletChain } from '../web-wallet/identity';
import type { FeeEstimate, FeeEstimateResult } from '../web-wallet/fees';
import type { SignTransactionInput, SignTransactionResult } from '../web-wallet/signing';
import type { UnsignedTransactionData } from '../web-wallet/prepare-tx';

export type {
  WalletChain,
  FeeEstimate,
  FeeEstimateResult,
  SignTransactionInput,
  SignTransactionResult,
  UnsignedTransactionData,
};

// ── SDK Configuration ──

export interface WalletSDKConfig {
  /** Base URL of the web-wallet API (e.g., 'https://example.com') */
  baseUrl: string;
  /** Optional custom fetch implementation (for testing or non-browser environments) */
  fetch?: typeof globalThis.fetch;
}

// ── API Response Envelope ──

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ── Wallet ──

export interface WalletInfo {
  walletId: string;
  status: string;
  createdAt: string;
  lastActiveAt: string | null;
  addressCount: number;
  settings: WalletSettingsSummary;
}

export interface WalletSettingsSummary {
  dailySpendLimit: number | null;
  whitelistEnabled: boolean;
  requireConfirmation: boolean;
}

// ── Addresses ──

export interface AddressSummary {
  addressId: string;
  chain: WalletChain;
  address: string;
  derivationIndex: number;
  isActive?: boolean;
  cachedBalance?: string | null;
}

export interface DeriveAddressResult {
  addressId: string;
  chain: WalletChain;
  address: string;
  derivationIndex: number;
  derivationPath: string;
  createdAt: string;
}

// ── Balances ──

export interface Balance {
  balance: string;
  chain: WalletChain;
  address: string;
  updatedAt: string;
}

// ── Transactions ──

export interface Transaction {
  id: string;
  walletId: string;
  chain: WalletChain;
  txHash: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
  amount: string;
  fromAddress: string;
  toAddress: string;
  feeAmount: string | null;
  feeCurrency: string | null;
  confirmations: number;
  blockNumber: number | null;
  blockTimestamp: string | null;
  createdAt: string;
}

export interface TransactionList {
  transactions: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransactionListOptions {
  chain?: WalletChain;
  direction?: 'incoming' | 'outgoing';
  status?: 'pending' | 'confirming' | 'confirmed' | 'failed';
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

// ── Send (prepare + sign + broadcast) ──

export interface SendOptions {
  fromAddress: string;
  toAddress: string;
  chain: WalletChain;
  amount: string;
  priority?: 'low' | 'medium' | 'high';
  /** Private key hex for signing. If omitted, uses stored key for fromAddress. */
  privateKey?: string;
}

export interface SendResult {
  txHash: string;
  chain: WalletChain;
  status: string;
  explorerUrl: string;
}

export interface PrepareTransactionResult {
  txId: string;
  chain: WalletChain;
  fromAddress: string;
  toAddress: string;
  amount: string;
  fee: FeeEstimate;
  expiresAt: string;
  unsignedTx: UnsignedTransactionData;
}

export interface BroadcastResult {
  txHash: string;
  chain: WalletChain;
  status: string;
  explorerUrl: string;
}

// ── Settings ──

export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | 'CHF' | 'CNY' | 'INR' | 'BRL';

export interface WalletSettings {
  walletId: string;
  dailySpendLimit: number | null;
  whitelistAddresses: string[];
  whitelistEnabled: boolean;
  requireConfirmation: boolean;
  confirmationDelaySeconds: number;
  displayCurrency: FiatCurrency;
}

export interface UpdateSettingsInput {
  dailySpendLimit?: number | null;
  whitelistAddresses?: string[];
  whitelistEnabled?: boolean;
  requireConfirmation?: boolean;
  confirmationDelaySeconds?: number;
  displayCurrency?: FiatCurrency;
}

// ── Events ──

export type WalletEventType =
  | 'transaction.incoming'
  | 'transaction.confirmed'
  | 'balance.changed';

export interface WalletEvent<T = unknown> {
  type: WalletEventType;
  data: T;
  timestamp: string;
}

export interface TransactionEvent {
  transaction: Transaction;
}

export interface BalanceChangedEvent {
  address: string;
  chain: WalletChain;
  previousBalance: string;
  newBalance: string;
}

// ── Total Balance USD ──

export interface BalanceWithUSD {
  chain: WalletChain;
  address: string;
  balance: string;
  usdValue: number;
  rate: number;
  updatedAt: string;
}

export interface TotalBalanceUSD {
  totalUsd: number;
  balances: BalanceWithUSD[];
}

// ── Webhooks ──

export interface WebhookRegistration {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  secret?: string;
  lastDeliveredAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdAt: string;
}

export interface RegisterWebhookInput {
  url: string;
  events?: string[];
}

export interface RegisterWebhookResult extends WebhookRegistration {
  /** The signing secret — only returned on creation. Store it securely. */
  secret: string;
}

// ── Swap Types ──

export interface SwapQuote {
  from: string;
  to: string;
  depositAmount: string;
  settleAmount: string;
  rate: string;
  minAmount?: number;
  expiresAt?: string;
}

export interface SwapQuoteParams {
  from: string;
  to: string;
  amount: string;
}

export interface SwapCreateParams {
  from: string;
  to: string;
  amount: string;
  settleAddress: string;
  refundAddress?: string;
  walletId?: string;
}

export interface Swap {
  id: string;
  from: string;
  to: string;
  depositAddress: string;
  depositAmount: string;
  settleAddress: string;
  settleAmount: string | null;
  status: SwapStatus;
  createdAt: string;
  expiresAt?: string;
}

export type SwapStatus =
  | 'pending'
  | 'processing'
  | 'settling'
  | 'settled'
  | 'finished'
  | 'failed'
  | 'refunded'
  | 'expired';

export interface SwapCoin {
  ticker: string;
  name: string;
  network: string;
}

export interface SwapHistoryOptions {
  status?: SwapStatus;
  limit?: number;
  offset?: number;
}
