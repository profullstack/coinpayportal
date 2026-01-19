import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, deriveKey } from '../crypto/encryption';

/**
 * Webhook event types
 */
export type WebhookEvent =
  | 'payment.confirmed'
  | 'payment.forwarded'
  | 'payment.expired'
  | 'payment.failed';

/**
 * Webhook payload structure
 */
export interface WebhookPayload {
  event: WebhookEvent;
  payment_id: string;
  business_id: string;
  amount_crypto: string;
  amount_usd: string;
  currency: string;
  status: string;
  confirmations?: number;
  tx_hash?: string;
  timestamp?: string;
  [key: string]: any;
}

/**
 * Webhook delivery result
 */
export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts?: number;
}

/**
 * Webhook log entry
 */
export interface WebhookLogEntry {
  business_id: string;
  payment_id: string;
  event: WebhookEvent;
  webhook_url: string;
  success: boolean;
  status_code?: number;
  error_message?: string;
  attempt_number: number;
  response_time_ms?: number;
}

/**
 * Generate webhook signature with timestamp
 *
 * Format: t=timestamp,v1=hmac_sha256_hex
 * The HMAC is computed as: HMAC-SHA256(timestamp.payload, secret)
 */
export function signWebhookPayload(
  payload: Partial<WebhookPayload> | Record<string, any>,
  secret: string,
  timestamp?: number
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const payloadString = JSON.stringify(payload);
  const signedPayload = `${ts}.${payloadString}`;

  const signature = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return `t=${ts},v1=${signature}`;
}

/**
 * Verify webhook signature
 *
 * Parses the timestamped format: t=timestamp,v1=signature
 * Verifies timestamp is within tolerance and signature matches
 */
export function verifyWebhookSignature(
  payload: Partial<WebhookPayload> | Record<string, any>,
  signature: string,
  secret: string,
  tolerance: number = 300
): boolean {
  try {
    // Parse signature header (format: t=timestamp,v1=signature)
    const parts: Record<string, string> = {};
    for (const part of signature.split(',')) {
      const [key, value] = part.split('=');
      if (key && value) {
        parts[key] = value;
      }
    }

    const timestamp = parts['t'];
    const receivedSig = parts['v1'];

    if (!timestamp || !receivedSig) {
      return false;
    }

    // Check timestamp is within tolerance (default 5 minutes)
    const timestampNum = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampNum) > tolerance) {
      return false;
    }

    // Compute expected signature: HMAC-SHA256(timestamp.payload, secret)
    const payloadString = JSON.stringify(payload);
    const signedPayload = `${timestamp}.${payloadString}`;
    const expectedSig = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Timing-safe comparison
    const receivedBuffer = Buffer.from(receivedSig, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');

    if (receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Deliver webhook to specified URL
 */
export async function deliverWebhook(
  webhookUrl: string,
  payload: Partial<WebhookPayload> | Record<string, any>,
  secret: string,
  timeout: number = 30000
): Promise<WebhookDeliveryResult> {
  try {
    // Add timestamp to payload
    const payloadWithTimestamp = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    // Sign the payload
    const signature = signWebhookPayload(payloadWithTimestamp, secret);

    // Deliver webhook
    const startTime = Date.now();
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinPay-Signature': signature,
        'User-Agent': 'CoinPay-Webhook/1.0',
      },
      body: JSON.stringify(payloadWithTimestamp),
      signal: AbortSignal.timeout(timeout),
    });

    const _responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
      };
    } else {
      return {
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Retry failed webhook with exponential backoff
 */
export async function retryFailedWebhook(
  webhookUrl: string,
  payload: Partial<WebhookPayload> | Record<string, any>,
  secret: string,
  maxRetries: number = 3
): Promise<WebhookDeliveryResult> {
  let lastResult: WebhookDeliveryResult = { success: false };
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await deliverWebhook(webhookUrl, payload, secret);
    
    if (lastResult.success) {
      return {
        ...lastResult,
        attempts: attempt,
      };
    }
    
    // Don't wait after the last attempt
    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s, 4s, 8s, etc.
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return {
    ...lastResult,
    attempts: maxRetries,
  };
}

/**
 * Log webhook attempt to database
 */
export async function logWebhookAttempt(
  supabase: SupabaseClient,
  logEntry: WebhookLogEntry
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('webhook_logs').insert({
      business_id: logEntry.business_id,
      payment_id: logEntry.payment_id,
      event: logEntry.event,
      webhook_url: logEntry.webhook_url,
      success: logEntry.success,
      status_code: logEntry.status_code,
      error_message: logEntry.error_message,
      attempt_number: logEntry.attempt_number,
      response_time_ms: logEntry.response_time_ms,
      created_at: new Date().toISOString(),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get webhook logs for a business
 */
export async function getWebhookLogs(
  supabase: SupabaseClient,
  businessId: string,
  options?: {
    payment_id?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ success: boolean; logs?: any[]; error?: string }> {
  try {
    let query = supabase
      .from('webhook_logs')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (options?.payment_id) {
      query = query.eq('payment_id', options.payment_id);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 100) - 1
      );
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, logs: data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send webhook for payment event
 */
export async function sendPaymentWebhook(
  supabase: SupabaseClient,
  businessId: string,
  paymentId: string,
  event: WebhookEvent,
  paymentData: any
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get business webhook configuration including merchant_id for decryption
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('webhook_url, webhook_secret, merchant_id')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.error(`[Webhook] Business not found: ${businessId}`, businessError);
      return { success: false, error: 'Business not found' };
    }

    if (!business.webhook_url) {
      // No webhook configured, skip silently
      console.log(`[Webhook] No webhook_url configured for business ${businessId}`);
      return { success: true };
    }

    // Decrypt webhook secret if it exists
    let decryptedSecret = '';
    if (business.webhook_secret && business.merchant_id) {
      try {
        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (encryptionKey) {
          const derivedKey = deriveKey(encryptionKey, business.merchant_id);
          decryptedSecret = decrypt(business.webhook_secret, derivedKey);
        } else {
          console.warn('[Webhook] ENCRYPTION_KEY not set, using empty secret');
        }
      } catch (decryptError) {
        console.error(`[Webhook] Failed to decrypt webhook secret for business ${businessId}:`, decryptError);
        // Continue with empty secret - webhook will be sent but signature may not verify
      }
    }

    // Prepare webhook payload
    // Include both 'event' and 'type' for compatibility with different receiver implementations
    // Spread all paymentData fields to include merchant_tx_hash, platform_tx_hash, etc.
    const payload: WebhookPayload = {
      event,
      type: event, // Alias for compatibility
      payment_id: paymentId,
      business_id: businessId,
      amount_crypto: paymentData.amount_crypto,
      amount_usd: paymentData.amount_usd,
      currency: paymentData.currency,
      status: paymentData.status,
      confirmations: paymentData.confirmations,
      tx_hash: paymentData.tx_hash,
      // Include additional fields from paymentData
      ...(paymentData.merchant_tx_hash && { merchant_tx_hash: paymentData.merchant_tx_hash }),
      ...(paymentData.platform_tx_hash && { platform_tx_hash: paymentData.platform_tx_hash }),
      ...(paymentData.merchant_amount !== undefined && { merchant_amount: paymentData.merchant_amount }),
      ...(paymentData.platform_fee !== undefined && { platform_fee: paymentData.platform_fee }),
      ...(paymentData.received_amount && { received_amount: paymentData.received_amount }),
      ...(paymentData.confirmed_at && { confirmed_at: paymentData.confirmed_at }),
      ...(paymentData.payment_address && { payment_address: paymentData.payment_address }),
    };

    console.log(`[Webhook] Sending ${event} webhook for payment ${paymentId} to ${business.webhook_url}`);

    // Deliver webhook with retries
    const result = await retryFailedWebhook(
      business.webhook_url,
      payload,
      decryptedSecret,
      3
    );

    // Log the attempt
    await logWebhookAttempt(supabase, {
      business_id: businessId,
      payment_id: paymentId,
      event,
      webhook_url: business.webhook_url,
      success: result.success,
      status_code: result.statusCode,
      error_message: result.error,
      attempt_number: result.attempts || 1,
    });

    if (result.success) {
      console.log(`[Webhook] Successfully delivered ${event} webhook for payment ${paymentId}`);
    } else {
      console.error(`[Webhook] Failed to deliver ${event} webhook for payment ${paymentId}: ${result.error}`);
    }

    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    console.error(`[Webhook] Error sending webhook for payment ${paymentId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}