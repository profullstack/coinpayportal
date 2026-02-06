/**
 * CoinPay API Client
 * Main client class for interacting with the CoinPay API
 */

/** Options for constructing a CoinPayClient */
export interface CoinPayClientOptions {
  /** Your CoinPay API key (starts with `cp_live_` or `cp_test_`) */
  apiKey: string;
  /** API base URL (default: `https://coinpayportal.com/api`) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: `30000`) */
  timeout?: number;
}

/** Parameters for creating a payment */
export interface PaymentParams {
  /** Business ID from your CoinPay dashboard */
  businessId: string;
  /** Amount in fiat currency (e.g., `100.00`) */
  amount: number;
  /** Fiat currency code (default: `'USD'`) */
  currency?: string;
  /** Blockchain/cryptocurrency code: `BTC`, `ETH`, `SOL`, `POL`, `BCH`, `USDC_ETH`, `USDC_POL`, `USDC_SOL` */
  blockchain: string;
  /** Payment description shown to the customer */
  description?: string;
  /** Custom metadata attached to the payment (e.g., `{ orderId: 'ORD-123' }`) */
  metadata?: Record<string, unknown>;
}

/** Parameters for listing payments */
export interface ListPaymentsParams {
  /** Business ID */
  businessId: string;
  /** Filter by payment status */
  status?: string;
  /** Number of results to return (default: `20`) */
  limit?: number;
  /** Pagination offset (default: `0`) */
  offset?: number;
}

/** Options for the `waitForPayment` polling method */
export interface WaitForPaymentOptions {
  /** Polling interval in milliseconds (default: `5000`) */
  interval?: number;
  /** Maximum wait time in milliseconds (default: `3600000` — 1 hour) */
  timeout?: number;
  /** Payment statuses that stop polling (default: `['confirmed', 'forwarded', 'expired', 'failed']`) */
  targetStatuses?: string[];
  /** Callback invoked when the payment status changes */
  onStatusChange?: (status: string, payment: Record<string, unknown>) => void;
}

/** Parameters for creating a business */
export interface CreateBusinessParams {
  /** Business name */
  name: string;
  /** Webhook URL for payment notifications */
  webhookUrl?: string;
  /** Wallet addresses keyed by blockchain code */
  walletAddresses?: Record<string, string>;
}

/** Generic API response envelope */
export interface ApiResponse<T = Record<string, unknown>> {
  success: boolean;
  [key: string]: unknown;
}

/** Payment object returned by the API */
export interface Payment {
  id: string;
  business_id: string;
  amount: number;
  currency: string;
  blockchain: string;
  crypto_amount: string;
  payment_address: string;
  qr_code?: string;
  status: string;
  tx_hash?: string;
  expires_at?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

/** Response from payment creation */
export interface CreatePaymentResponse {
  success: boolean;
  payment: Payment;
  usage?: {
    current: number;
    limit: number;
    remaining: number;
  };
}

/** Response from getting a single payment */
export interface GetPaymentResponse {
  success: boolean;
  payment: Payment;
}

/** Response from listing payments */
export interface ListPaymentsResponse {
  success: boolean;
  payments: Payment[];
}

/**
 * CoinPay API Client
 *
 * The primary class for interacting with the CoinPay payment API.
 * Handles authentication, request signing, and provides methods
 * for all API operations.
 *
 * @example
 * ```typescript
 * import { CoinPayClient } from '@profullstack/coinpay';
 *
 * const client = new CoinPayClient({ apiKey: 'cp_live_xxxxx' });
 *
 * const payment = await client.createPayment({
 *   businessId: 'biz_123',
 *   amount: 99.99,
 *   blockchain: 'BTC',
 * });
 * ```
 */
export class CoinPayClient {
  /**
   * Create a new CoinPay client
   * @throws {Error} If `apiKey` is not provided
   */
  constructor(options: CoinPayClientOptions);

  /**
   * Make an authenticated API request.
   *
   * Automatically adds `Authorization: Bearer <apiKey>` and `Content-Type: application/json` headers.
   * Handles timeouts via `AbortController`.
   *
   * @param endpoint - API endpoint path (e.g., `/payments/create`)
   * @param options  - Standard `fetch` options (method, body, headers, etc.)
   * @returns Parsed JSON response
   * @throws {Error} On HTTP errors (non-2xx) or timeout
   */
  request(endpoint: string, options?: RequestInit): Promise<Record<string, unknown>>;

  /**
   * Create a new payment request.
   *
   * Generates a unique blockchain address and optional QR code for the customer to pay.
   *
   * @returns Created payment with `payment_address`, `crypto_amount`, and `qr_code`
   */
  createPayment(params: PaymentParams): Promise<CreatePaymentResponse>;

  /**
   * Get payment details by ID.
   *
   * @param paymentId - Payment ID (e.g., `'pay_abc123'`)
   * @returns Payment details including current status
   */
  getPayment(paymentId: string): Promise<GetPaymentResponse>;

  /**
   * Poll until a payment reaches a terminal status.
   *
   * Terminal statuses: `confirmed`, `forwarded`, `expired`, `failed`.
   * For production, prefer webhooks over polling.
   *
   * @param paymentId - Payment ID
   * @param options   - Polling configuration
   * @returns Final payment details
   * @throws {Error} If timeout is reached before a terminal status
   */
  waitForPayment(paymentId: string, options?: WaitForPaymentOptions): Promise<GetPaymentResponse>;

  /**
   * List payments for a business.
   *
   * @returns Paginated list of payments
   */
  listPayments(params: ListPaymentsParams): Promise<ListPaymentsResponse>;

  /**
   * Get a URL pointing to the QR code image for a payment.
   *
   * The URL returns binary PNG data suitable for `<img src="...">`.
   * This method is synchronous — it does not make a network request.
   *
   * @param paymentId - Payment ID
   * @returns Full URL to the QR code PNG endpoint
   */
  getPaymentQRUrl(paymentId: string): string;

  /**
   * Fetch the QR code image as binary data.
   *
   * @param paymentId - Payment ID
   * @returns QR code PNG image as an `ArrayBuffer`
   */
  getPaymentQR(paymentId: string): Promise<ArrayBuffer>;

  /**
   * Get the exchange rate for a cryptocurrency.
   *
   * @param cryptocurrency - Crypto code (e.g., `'BTC'`, `'ETH'`)
   * @param fiatCurrency   - Fiat code (default: `'USD'`)
   */
  getExchangeRate(cryptocurrency: string, fiatCurrency?: string): Promise<Record<string, unknown>>;

  /**
   * Get exchange rates for multiple cryptocurrencies in a single request.
   *
   * @param cryptocurrencies - Array of crypto codes
   * @param fiatCurrency     - Fiat code (default: `'USD'`)
   */
  getExchangeRates(cryptocurrencies: string[], fiatCurrency?: string): Promise<Record<string, unknown>>;

  /**
   * Get business details.
   *
   * @param businessId - Business ID
   */
  getBusiness(businessId: string): Promise<Record<string, unknown>>;

  /** List all businesses associated with your API key. */
  listBusinesses(): Promise<Record<string, unknown>>;

  /**
   * Create a new business.
   *
   * @param params - Business creation parameters
   */
  createBusiness(params: CreateBusinessParams): Promise<Record<string, unknown>>;

  /**
   * Update an existing business.
   *
   * @param businessId - Business ID
   * @param params     - Fields to update
   */
  updateBusiness(businessId: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;

  /**
   * Get webhook delivery logs for a business.
   *
   * @param businessId - Business ID
   * @param limit      - Number of log entries (default: `50`)
   */
  getWebhookLogs(businessId: string, limit?: number): Promise<Record<string, unknown>>;

  /**
   * Send a test webhook event to your configured endpoint.
   *
   * @param businessId - Business ID
   * @param eventType  - Event type to simulate (default: `'payment.completed'`)
   */
  testWebhook(businessId: string, eventType?: string): Promise<Record<string, unknown>>;
}

export default CoinPayClient;
