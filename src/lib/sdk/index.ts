/**
 * SDK Integration Module
 *
 * This module provides integration with the @profullstack/coinpay SDK
 * for use within the CoinPay Portal application.
 *
 * External applications should install the SDK directly:
 * pnpm add @profullstack/coinpay
 *
 * @module @/lib/sdk
 */

// Re-export SDK components for internal use
// Note: The SDK is a pure JavaScript ESM module
import {
  CoinPayClient as SDKCoinPayClient,
  verifyWebhookSignature as sdkVerifyWebhookSignature,
  generateWebhookSignature as sdkGenerateWebhookSignature,
  parseWebhookPayload as sdkParseWebhookPayload,
  createWebhookHandler as sdkCreateWebhookHandler,
  WebhookEvent as SDKWebhookEvent,
} from '@profullstack/coinpay';

// Re-export for direct use
export const CoinPayClient = SDKCoinPayClient;
export const verifyWebhookSignature = sdkVerifyWebhookSignature;
export const generateWebhookSignature = sdkGenerateWebhookSignature;
export const parseWebhookPayload = sdkParseWebhookPayload;
export const createWebhookHandler = sdkCreateWebhookHandler;
export const WebhookEvent = SDKWebhookEvent;

// Type definitions for TypeScript compatibility
export interface CoinPayClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface CreatePaymentParams {
  businessId: string;
  amount: number;
  currency: string;
  cryptocurrency: string;
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  id: string;
  business_id: string;
  amount_usd: string;
  amount_crypto: string;
  currency: string;
  cryptocurrency: string;
  wallet_address: string;
  status: string;
  expires_at: string;
  created_at: string;
  metadata?: Record<string, any>;
}

export interface WebhookPayload {
  id: string;
  type: string;
  data: Record<string, any>;
  created_at: string;
  business_id: string;
}

export interface VerifyWebhookParams {
  payload: string;
  signature: string;
  secret: string;
  tolerance?: number;
}

/**
 * Create a CoinPay client instance for server-side API calls
 *
 * @example
 * ```typescript
 * import { createCoinPayClient } from '@/lib/sdk';
 *
 * const client = createCoinPayClient(process.env.COINPAY_API_KEY!);
 * const payment = await client.createPayment({
 *   businessId: 'biz_123',
 *   amount: 100,
 *   currency: 'USD',
 *   cryptocurrency: 'BTC',
 * });
 * ```
 */
export function createCoinPayClient(
  apiKey: string,
  baseUrl?: string
): InstanceType<typeof SDKCoinPayClient> {
  return new SDKCoinPayClient({
    apiKey,
    baseUrl: baseUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080',
  });
}

/**
 * Verify an incoming webhook signature using the SDK
 *
 * The SDK expects:
 * - payload: Raw request body as a string
 * - signature: Header value in format "t=timestamp,v1=signature"
 * - secret: Your webhook secret
 *
 * @example
 * ```typescript
 * import { verifyIncomingWebhook } from '@/lib/sdk';
 *
 * // In your webhook handler:
 * const rawBody = await request.text();
 * const signature = request.headers.get('x-coinpay-signature');
 *
 * const isValid = verifyIncomingWebhook(rawBody, signature, process.env.WEBHOOK_SECRET!);
 * ```
 */
export function verifyIncomingWebhook(
  payload: string,
  signature: string,
  secret: string,
  tolerance?: number
): boolean {
  return sdkVerifyWebhookSignature({ payload, signature, secret, tolerance });
}

/**
 * Generate a webhook signature for testing purposes
 *
 * @example
 * ```typescript
 * import { generateTestWebhookSignature } from '@/lib/sdk';
 *
 * const payload = JSON.stringify({ type: 'payment.completed', data: { ... } });
 * const signature = generateTestWebhookSignature(payload, 'your-secret');
 * // signature = "t=1234567890,v1=abc123..."
 * ```
 */
export function generateTestWebhookSignature(
  payload: string,
  secret: string,
  timestamp?: number
): string {
  return sdkGenerateWebhookSignature({ payload, secret, timestamp });
}