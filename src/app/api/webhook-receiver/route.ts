/**
 * Example Webhook Receiver Endpoint
 *
 * Receives and verifies CoinPay webhooks using the @profullstack/coinpay SDK.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyIncomingWebhook, WebhookEvent } from '@/lib/sdk';
import { getWebhookSecret } from '@/lib/secrets';

/** Maximum event records kept in memory to prevent unbounded growth. */
const MAX_EVENT_STORE = 1000;

interface EventRecord {
  id: string;
  type: string;
  business_id: string;
  received_at: string;
  processed: boolean;
  status: 'pending' | 'awaiting_payment' | 'confirming' | 'completed' | 'expired' | 'failed' | 'refunded';
  data?: any;
}

/** In-memory store with eviction — oldest entries removed when limit is exceeded. */
const eventStore: Map<string, EventRecord> = new Map();

function trimStore(): void {
  if (eventStore.size <= MAX_EVENT_STORE) return;
  const keysToDelete = [...eventStore.keys()].slice(0, eventStore.size - MAX_EVENT_STORE);
  for (const key of keysToDelete) eventStore.delete(key);
}

function trackEvent(type: string, id: string, business_id: string, data: any): EventRecord {
  const statusMap: Record<string, EventRecord['status']> = {
    [WebhookEvent.PAYMENT_CREATED]: 'pending',
    [WebhookEvent.PAYMENT_PENDING]: 'awaiting_payment',
    [WebhookEvent.PAYMENT_CONFIRMING]: 'confirming',
    [WebhookEvent.PAYMENT_COMPLETED]: 'completed',
    [WebhookEvent.PAYMENT_EXPIRED]: 'expired',
    [WebhookEvent.PAYMENT_FAILED]: 'failed',
    [WebhookEvent.PAYMENT_REFUNDED]: 'refunded',
  };

  const event: EventRecord = {
    id,
    type,
    business_id: business_id || 'unknown',
    received_at: new Date().toISOString(),
    processed: false,
    status: statusMap[type] || 'pending',
    data,
  };

  eventStore.set(id, event);
  trimStore();
  console.log(`[WebhookTracker] ${type} → ${event.status} | business: ${event.business_id} | id: ${id}`);
  return event;
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-coinpay-signature');
    if (!signature) {
      return NextResponse.json(
        { success: false, error: 'Missing X-CoinPay-Signature header' },
        { status: 401 }
      );
    }

    const rawBody = await request.text();
    const webhookSecret = getWebhookSecret();

    if (!webhookSecret) {
      console.error('WEBHOOK_SECRET environment variable is not set');
      return NextResponse.json(
        { error: 'Internal server error — webhook secret not configured' },
        { status: 500 }
      );
    }

    const isValid = verifyIncomingWebhook(rawBody, signature, webhookSecret);
    if (!isValid) {
      console.warn('Invalid webhook signature received');
      return NextResponse.json(
        { success: false, error: 'Invalid webhook signature' },
        { status: 401 }
      );
    }

    let event: { type: string; id: string; data?: any; business_id?: string };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in webhook payload' },
        { status: 400 }
      );
    }

    const { type, id, data, business_id } = event;

    if (!type || !id) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: type, id' },
        { status: 400 }
      );
    }

    const record = trackEvent(type, id, business_id ?? '', data);

    switch (type) {
      case WebhookEvent.PAYMENT_CREATED:
        break;

      case WebhookEvent.PAYMENT_PENDING:
        break;

      case WebhookEvent.PAYMENT_CONFIRMING:
        break;

      case WebhookEvent.PAYMENT_COMPLETED:
        console.log(`[Fulfillment] Payment completed for ${id}, business ${business_id}`);
        break;

      case WebhookEvent.PAYMENT_EXPIRED:
        break;

      case WebhookEvent.PAYMENT_FAILED:
        break;

      case WebhookEvent.PAYMENT_REFUNDED:
        break;

      case WebhookEvent.BUSINESS_CREATED:
        console.log('Business created:', data);
        break;

      case WebhookEvent.BUSINESS_UPDATED:
        console.log('Business updated:', data);
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${type}`);
    }

    // Mark processed (in-place mutation — already in the Map)
    record.processed = true;

    return NextResponse.json({
      success: true,
      received: true,
      event_type: type,
      event_id: id,
      status: record.status,
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
