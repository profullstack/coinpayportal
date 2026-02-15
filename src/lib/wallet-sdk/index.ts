export { Wallet } from './wallet';
export { WalletAPIClient } from './client';
export { WalletEventEmitter } from './events';
export { encryptSeedPhrase, decryptSeedPhrase } from './backup';

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
  TotalBalanceUSD,
  BalanceWithUSD,
  WebhookRegistration,
  RegisterWebhookInput,
  RegisterWebhookResult,
  SwapQuote,
  SwapCreateParams,
  Swap,
  SwapCoin,
  SwapStatus,
  SwapHistoryOptions,
  LightningAddress,
  LightningInvoice,
  LightningPayment,
  LightningPaymentStatus,
} from './types';

export type { EncryptedBackup } from './backup';
