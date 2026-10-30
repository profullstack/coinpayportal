/**
 * @profullstack/coinpay - CoinPay SDK
 * Cryptocurrency payment integration for Node.js
 *
 * @module @profullstack/coinpay
 */

// Client exports
export { CoinPayClient } from './client.js';
export { AgentWalletClient } from './agents.js';
export type { AgentWalletInput } from './agents.js';
export type { 
  CoinPayClientOptions, 
  PaymentParams, 
  ListPaymentsParams, 
  WaitForPaymentOptions, 
  CreateBusinessParams,
  SupportedCoinsParams,
  SupportedCoin,
  SupportedToken,
  SupportedCoinsResponse,
  TokensResponse,
} from './client.js';

export {
  getTokens,
  getSupportedCoins,
} from './tokens.js';
export type {
  TokenDiscoveryParams,
} from './tokens.js';

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

// Invoice exports
export {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
  deleteInvoice,
  publishInvoice,
  sendInvoice,
  getInvoicePaymentData,
  InvoiceStatus,
  listTaxRates,
  createTaxRate,
  deleteTaxRate,
  listInvoiceItems,
  createInvoiceItem,
  deleteInvoiceItem,
} from './invoices.js';
export type {
  Invoice,
  InvoiceLine,
  InvoiceLineInput,
  InvoiceDiscount,
  TaxRate,
  InvoiceItem,
  InvoiceStatusType,
  CreateInvoiceParams,
  ListInvoicesParams,
  UpdateInvoiceParams,
  ListInvoicesResult,
} from './invoices.js';

// Projects, time, aging, invoice settings, portal links
export {
  getArAging,
  getInvoiceSettings,
  updateInvoiceSettings,
  createClientPortalLink,
  revokeClientPortalLink,
  listProjects,
  getProject,
  createProject,
  logTime,
  startTimer,
  stopTimer,
  listTimeEntries,
  invoiceProjectTime,
} from './projects.js';
export type { ArAging, AgingRow, InvoiceSettings, Project, ProjectStats, TimeEntry } from './projects.js';
export {
  listContractors,
  getContractor,
  addContractor,
  createContractorPortalLink,
  offboardContractor,
  createContract,
  sendContract,
  endContract,
  listWorkItems,
  reviewWorkItem,
  addContractorPayment,
  listPayRuns,
  getPayRun,
  createPayRun,
  deletePayRun,
  payPayRun,
  recordPayRunPayments,
  get1099Summary,
} from './contractors.js';
export type { Contractor, ContractorContract, ContractorMilestone, ContractorWorkItem, PayRun, PayRunItem, PayOutcome } from './contractors.js';
export {
  listDocuments,
  getDocument,
  listDocumentVaults,
  setupDocumentsVault,
  unlockDocumentsVault,
  uploadDocument,
  shareDocument,
  newDocumentLink,
  revokeDocumentRecipient,
  voidDocument,
  deleteDocument,
  downloadDocument,
  listDocumentVersions,
  uploadDocumentVersion,
  moveDocument,
} from './documents.js';
export { publishDirectory, planPublish } from './documents-publish.js';
export type { PublishEntry, PublishResult } from './documents-publish.js';
export type { CoinPayDocument, DocumentRecipient, DocumentVault, DocumentVersion, UnlockedVault } from './documents.js';

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

// Reputation exports
export {
  submitReceipt,
  getReputation,
  getCredential,
  verifyCredential,
  getRevocationList,
} from './reputation.js';
export type {
  ReceiptInput,
  ReputationWindow,
  ReputationResult,
  Credential,
} from './reputation.js';

import { CoinPayClient } from './client.js';
export default CoinPayClient;

export * from './finances.js';
export * from './finances-reports.js';
