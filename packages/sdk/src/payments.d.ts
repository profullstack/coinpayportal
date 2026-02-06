/**
 * Payment utilities for CoinPay SDK
 *
 * Standalone functions for creating and managing payments without
 * manually instantiating a `CoinPayClient`.
 */

import { CoinPayClient } from './client.js';

/** Parameters for the standalone `createPayment` function */
export interface CreatePaymentParams {
  /** API key — required if `client` is not provided */
  apiKey?: string;
  /** Existing CoinPayClient instance (takes precedence over `apiKey`) */
  client?: CoinPayClient;
  /** Business ID from your CoinPay dashboard */
  businessId: string;
  /** Amount in fiat currency */
  amount: number;
  /** Fiat currency code (default: `'USD'`) */
  currency?: string;
  /** Blockchain code: `BTC`, `ETH`, `SOL`, `POL`, `BCH`, `USDC_ETH`, `USDC_POL`, `USDC_SOL` */
  blockchain: string;
  /** Payment description shown to the customer */
  description?: string;
  /** Custom metadata for your records */
  metadata?: Record<string, unknown>;
}

/** Parameters for the standalone `getPayment` function */
export interface GetPaymentParams {
  /** API key — required if `client` is not provided */
  apiKey?: string;
  /** Existing CoinPayClient instance */
  client?: CoinPayClient;
  /** Payment ID to look up */
  paymentId: string;
}

/** Parameters for the standalone `listPayments` function */
export interface ListPaymentsFnParams {
  /** API key — required if `client` is not provided */
  apiKey?: string;
  /** Existing CoinPayClient instance */
  client?: CoinPayClient;
  /** Business ID */
  businessId: string;
  /** Filter by payment status */
  status?: string;
  /** Number of results (default: `20`) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Create a payment using an API key or existing client.
 *
 * Convenience wrapper — for multiple operations, prefer creating a
 * `CoinPayClient` instance and reusing it.
 *
 * @example
 * ```typescript
 * import { createPayment, Blockchain } from '@profullstack/coinpay';
 *
 * const result = await createPayment({
 *   apiKey: 'cp_live_xxxxx',
 *   businessId: 'biz_123',
 *   amount: 50,
 *   blockchain: Blockchain.BTC,
 * });
 * console.log(result.payment.payment_address);
 * ```
 */
export function createPayment(params: CreatePaymentParams): Promise<Record<string, unknown>>;

/**
 * Get a payment by ID.
 *
 * @example
 * ```typescript
 * const result = await getPayment({
 *   apiKey: 'cp_live_xxxxx',
 *   paymentId: 'pay_abc123',
 * });
 * console.log(result.payment.status);
 * ```
 */
export function getPayment(params: GetPaymentParams): Promise<Record<string, unknown>>;

/**
 * List payments for a business.
 *
 * @example
 * ```typescript
 * const result = await listPayments({
 *   apiKey: 'cp_live_xxxxx',
 *   businessId: 'biz_123',
 *   status: 'completed',
 *   limit: 10,
 * });
 * console.log(result.payments);
 * ```
 */
export function listPayments(params: ListPaymentsFnParams): Promise<Record<string, unknown>>;

/**
 * Supported blockchains/cryptocurrencies.
 *
 * Use these constants when creating payments to avoid typos.
 */
export declare const Blockchain: {
  /** Bitcoin */
  readonly BTC: 'BTC';
  /** Bitcoin Cash */
  readonly BCH: 'BCH';
  /** Ethereum */
  readonly ETH: 'ETH';
  /** Polygon (POL) */
  readonly POL: 'POL';
  /** Solana */
  readonly SOL: 'SOL';
  /** USDC on Ethereum */
  readonly USDC_ETH: 'USDC_ETH';
  /** USDC on Polygon */
  readonly USDC_POL: 'USDC_POL';
  /** USDC on Solana */
  readonly USDC_SOL: 'USDC_SOL';
};

/**
 * @deprecated Use `Blockchain` instead.
 */
export declare const Cryptocurrency: typeof Blockchain;

/** Payment status constants */
export declare const PaymentStatus: {
  readonly PENDING: 'pending';
  readonly CONFIRMING: 'confirming';
  readonly COMPLETED: 'completed';
  readonly EXPIRED: 'expired';
  readonly FAILED: 'failed';
  readonly REFUNDED: 'refunded';
};

/** Supported fiat currencies */
export declare const FiatCurrency: {
  readonly USD: 'USD';
  readonly EUR: 'EUR';
  readonly GBP: 'GBP';
  readonly CAD: 'CAD';
  readonly AUD: 'AUD';
};
