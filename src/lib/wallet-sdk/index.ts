export { Wallet } from './wallet';
export { WalletAPIClient } from './client';
export { WalletEventEmitter } from './events';

export {
  WalletSDKError,
  AuthenticationError,
  InsufficientFundsError,
  InvalidAddressError,
  NetworkError,
  RateLimitError,
  TransactionExpiredError,
} from './errors';

export type {
  WalletSDKConfig,
  WalletInfo,
  AddressSummary,
  DeriveAddressResult,
  Balance,
  Transaction,
  TransactionList,
  TransactionListOptions,
  SendOptions,
  SendResult,
  PrepareTransactionResult,
  BroadcastResult,
  WalletSettings,
  UpdateSettingsInput,
  WalletChain,
  FeeEstimateResult,
  FeeEstimate,
  WalletEventType,
  WalletEvent,
  TransactionEvent,
  BalanceChangedEvent,
} from './types';
