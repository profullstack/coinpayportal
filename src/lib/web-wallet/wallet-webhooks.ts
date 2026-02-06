/**
 * Web Wallet Webhook Service
 *
 * Manages webhook registrations for wallet event notifications.
 * Supports: transaction.incoming, transaction.confirmed, balance.changed
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, createHmac } from 'crypto';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type WebhookEventType =
  | 'transaction.incoming'
  | 'transaction.confirmed'
  | 'balance.changed';

export const VALID_WEBHOOK_EVENTS: WebhookEventType[] = [
  'transaction.incoming',
  'transaction.confirmed',
  'balance.changed',
];

export interface WebhookRegistration {
  id: string;
  wallet_id: string;
  url: string;
  events: WebhookEventType[];
  is_active: boolean;
  last_delivered_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: string;
}

export interface RegisterWebhookInput {
  url: string;
  events?: WebhookEventType[];
}

// ──────────────────────────────────────────────
// CRUD Operations
// ──────────────────────────────────────────────

/**
 * Register a new webhook for a wallet.
 */
export async function registerWebhook(
  supabase: SupabaseClient,
  walletId: string,
  input: RegisterWebhookInput
): Promise<{ success: true; data: WebhookRegistration & { secret: string } } | { success: false; error: string; code?: string }> {
  console.log(`[Webhooks] Registering webhook for wallet ${walletId}: ${input.url}`);

  // Validate URL
  if (!input.url || !isValidWebhookUrl(input.url)) {
    console.error(`[Webhooks] Invalid webhook URL: ${input.url}`);
    return { success: false, error: 'Webhook URL must be a valid HTTPS URL', code: 'INVALID_URL' };
  }

  // Validate events
  const events = input.events || VALID_WEBHOOK_EVENTS;
  for (const event of events) {
    if (!VALID_WEBHOOK_EVENTS.includes(event)) {
      return { success: false, error: `Invalid event type: ${event}`, code: 'INVALID_EVENT' };
    }
  }

  // Check max webhooks per wallet (limit to 5)
  const { count, error: countError } = await supabase
    .from('wallet_webhooks')
    .select('id', { count: 'exact', head: true })
    .eq('wallet_id', walletId);

  if (!countError && count !== null && count >= 5) {
    return { success: false, error: 'Maximum 5 webhooks per wallet', code: 'WEBHOOK_LIMIT' };
  }

  // Generate a signing secret
  const secret = randomBytes(32).toString('hex');

  const { data, error } = await supabase
    .from('wallet_webhooks')
    .insert({
      wallet_id: walletId,
      url: input.url,
      events,
      secret,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      console.error(`[Webhooks] Duplicate URL for wallet ${walletId}: ${input.url}`);
      return { success: false, error: 'Webhook URL already registered for this wallet', code: 'DUPLICATE_URL' };
    }
    console.error(`[Webhooks] DB error registering webhook for wallet ${walletId}:`, error.message);
    return { success: false, error: 'Failed to register webhook', code: 'DB_ERROR' };
  }

  console.log(`[Webhooks] Webhook registered: ${data.id} for wallet ${walletId}, events=[${events.join(', ')}]`);

  return {
    success: true,
    data: {
      ...formatWebhook(data),
      secret,
    },
  };
}

/**
 * List all webhooks for a wallet.
 */
export async function listWebhooks(
  supabase: SupabaseClient,
  walletId: string
): Promise<{ success: true; data: WebhookRegistration[] } | { success: false; error: string; code?: string }> {
  const { data, error } = await supabase
    .from('wallet_webhooks')
    .select('*')
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: true });

  if (error) {
    return { success: false, error: 'Failed to list webhooks', code: 'DB_ERROR' };
  }

  return {
    success: true,
    data: (data || []).map(formatWebhook),
  };
}

/**
 * Delete a webhook registration.
 */
export async function deleteWebhook(
  supabase: SupabaseClient,
  walletId: string,
  webhookId: string
): Promise<{ success: true } | { success: false; error: string; code?: string }> {
  console.log(`[Webhooks] Deleting webhook ${webhookId} for wallet ${walletId}`);

  const { error, count } = await supabase
    .from('wallet_webhooks')
    .delete({ count: 'exact' })
    .eq('id', webhookId)
    .eq('wallet_id', walletId);

  if (error) {
    return { success: false, error: 'Failed to delete webhook', code: 'DB_ERROR' };
  }

  if (count === 0) {
    console.error(`[Webhooks] Webhook ${webhookId} not found for wallet ${walletId}`);
    return { success: false, error: 'Webhook not found', code: 'WEBHOOK_NOT_FOUND' };
  }

  console.log(`[Webhooks] Webhook ${webhookId} deleted`);
  return { success: true };
}

// ──────────────────────────────────────────────
// Webhook Delivery
// ──────────────────────────────────────────────

/**
 * Deliver a webhook payload to all active webhooks for a wallet
 * that are subscribed to the given event.
 */
export async function deliverWebhook(
  supabase: SupabaseClient,
  walletId: string,
  event: WebhookEventType,
  payload: Record<string, unknown>
): Promise<{ delivered: number; failed: number }> {
  console.log(`[Webhooks] Delivering "${event}" event for wallet ${walletId}`);

  // Get active webhooks for this wallet that listen for this event
  const { data: webhooks, error } = await supabase
    .from('wallet_webhooks')
    .select('*')
    .eq('wallet_id', walletId)
    .eq('is_active', true);

  if (error || !webhooks || webhooks.length === 0) {
    return { delivered: 0, failed: 0 };
  }

  let delivered = 0;
  let failed = 0;

  for (const webhook of webhooks) {
    const events = webhook.events as WebhookEventType[];
    if (!events.includes(event)) continue;

    try {
      const body = JSON.stringify({
        event,
        wallet_id: walletId,
        data: payload,
        timestamp: new Date().toISOString(),
      });

      const signature = createHmac('sha256', webhook.secret)
        .update(body)
        .digest('hex');

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        delivered++;
        await supabase
          .from('wallet_webhooks')
          .update({
            last_delivered_at: new Date().toISOString(),
            last_error: null,
            consecutive_failures: 0,
          })
          .eq('id', webhook.id);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err: any) {
      failed++;
      const errorMsg = err.message || 'Unknown error';
      const failures = (webhook.consecutive_failures || 0) + 1;
      console.error(`[Webhooks] Delivery failed to ${webhook.url}: ${errorMsg} (failures=${failures})`);


      await supabase
        .from('wallet_webhooks')
        .update({
          last_error: errorMsg,
          consecutive_failures: failures,
          // Disable after 10 consecutive failures
          is_active: failures < 10,
        })
        .eq('id', webhook.id);
    }
  }

  console.log(`[Webhooks] Delivery complete for "${event}": ${delivered} delivered, ${failed} failed`);

  return { delivered, failed };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatWebhook(raw: any): WebhookRegistration {
  return {
    id: raw.id,
    wallet_id: raw.wallet_id,
    url: raw.url,
    events: raw.events || [],
    is_active: raw.is_active ?? true,
    last_delivered_at: raw.last_delivered_at ?? null,
    last_error: raw.last_error ?? null,
    consecutive_failures: raw.consecutive_failures ?? 0,
    created_at: raw.created_at,
  };
}
