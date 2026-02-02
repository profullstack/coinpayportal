/**
 * Webhook utilities for CoinPay SDK
 *
 * Functions for verifying, parsing, and handling webhook events
 * sent by the CoinPay API.
 */

import type { IncomingMessage, ServerResponse } from 'http';

/** Parameters for `verifyWebhookSignature` */
export interface VerifyWebhookParams {
  /** Raw request body as a string */
  payload: string;
  /** Value of the `X-CoinPay-Signature` header */
  signature: string;
  /** Your webhook secret (from the CoinPay dashboard) */
  secret: string;
  /** Timestamp tolerance in seconds (default: `300` — 5 minutes) */
  tolerance?: number;
}

/** Parameters for `generateWebhookSignature` */
export interface GenerateWebhookParams {
  /** Request body as a string */
  payload: string;
  /** Webhook secret */
  secret: string;
  /** Unix timestamp in seconds (default: current time) */
  timestamp?: number;
}

/** Parsed webhook event returned by `parseWebhookPayload` */
export interface ParsedWebhookEvent {
  /** Event ID */
  id: string;
  /** Event type (e.g., `'payment.completed'`) */
  type: string;
  /** Event-specific data */
  data: Record<string, unknown>;
  /** When the event was created */
  createdAt: Date;
  /** Business ID associated with the event */
  businessId: string;
}

/** Options for `createWebhookHandler` */
export interface WebhookHandlerOptions {
  /** Your webhook secret */
  secret: string;
  /** Async callback invoked for each verified event */
  onEvent: (event: ParsedWebhookEvent) => Promise<void> | void;
  /** Optional error handler */
  onError?: (error: Error) => void;
}

/** Webhook event type string constants */
export declare const WebhookEvent: {
  readonly PAYMENT_CREATED: 'payment.created';
  readonly PAYMENT_PENDING: 'payment.pending';
  readonly PAYMENT_CONFIRMING: 'payment.confirming';
  readonly PAYMENT_COMPLETED: 'payment.completed';
  readonly PAYMENT_EXPIRED: 'payment.expired';
  readonly PAYMENT_FAILED: 'payment.failed';
  readonly PAYMENT_REFUNDED: 'payment.refunded';
  readonly BUSINESS_CREATED: 'business.created';
  readonly BUSINESS_UPDATED: 'business.updated';
};

/**
 * Verify a webhook signature from the `X-CoinPay-Signature` header.
 *
 * Signature format: `t=<timestamp>,v1=<hmac-sha256-hex>`
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @returns `true` if the signature is valid and within the tolerance window
 * @throws {Error} If `payload`, `signature`, or `secret` is missing
 *
 * @example
 * ```typescript
 * import { verifyWebhookSignature } from '@profullstack/coinpay';
 *
 * const isValid = verifyWebhookSignature({
 *   payload: rawBody,
 *   signature: req.headers['x-coinpay-signature'],
 *   secret: process.env.COINPAY_WEBHOOK_SECRET,
 * });
 * ```
 */
export function verifyWebhookSignature(params: VerifyWebhookParams): boolean;

/**
 * Generate a webhook signature (primarily for testing).
 *
 * @returns Signature string in `t=<timestamp>,v1=<hex>` format
 */
export function generateWebhookSignature(params: GenerateWebhookParams): string;

/**
 * Parse a raw webhook JSON payload into a structured event object.
 *
 * @param payload - Raw JSON string from the request body
 * @returns Parsed event with `id`, `type`, `data`, `createdAt`, `businessId`
 * @throws {Error} If the payload is not valid JSON
 */
export function parseWebhookPayload(payload: string): ParsedWebhookEvent;

/**
 * Create an Express/Connect-compatible webhook handler middleware.
 *
 * Automatically verifies the signature, parses the payload, and calls your
 * `onEvent` handler. Returns `401` for invalid signatures and `200` on success.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createWebhookHandler, WebhookEvent } from '@profullstack/coinpay';
 *
 * const app = express();
 * app.use(express.raw({ type: 'application/json' }));
 *
 * app.post('/webhook', createWebhookHandler({
 *   secret: process.env.COINPAY_WEBHOOK_SECRET,
 *   onEvent: async (event) => {
 *     if (event.type === WebhookEvent.PAYMENT_COMPLETED) {
 *       await fulfillOrder(event.data);
 *     }
 *   },
 * }));
 * ```
 */
export function createWebhookHandler(
  options: WebhookHandlerOptions
): (req: any, res: any) => Promise<void>;
