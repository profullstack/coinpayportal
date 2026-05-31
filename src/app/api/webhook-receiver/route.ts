/**
 * Example Webhook Receiver Endpoint
 *
 * This endpoint demonstrates how external applications would use the
 * @profullstack/coinpay SDK to receive and verify webhooks from CoinPay.
 *
 * External applications should implement a similar endpoint:
 *
 * ```javascript
 * import { verifyWebhookSignature, parseWebhookPayload, WebhookEvent } from '@profullstack/coinpay';
 *
 * // Express.js example with raw body parsing
 * app.post('/webhooks/coinpay', express.raw({ type: 'application/json' }), (req, res) => {
 *   const signature = req.headers['x-coinpay-signature'];
 *   const payload = req.body.toString();
 *
 *   const isValid = verifyWebhookSignature({
 *     payload,
 *     signature,
 *     secret: process.env.WEBHOOK_SECRET
 *   });
 *
 *   if (!isValid) {
 *     return res.status(401).json({ error: 'Invalid signature' });
 *   }
 *
 *   const event = parseWebhookPayload(payload);
 *
 *   switch (event.type) {
 *     case WebhookEvent.PAYMENT_COMPLETED:
 *       console.log('Payment completed:', event.data);
 *       break;
 *   }
 *
 *   res.json({ received: true });
 * });
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyIncomingWebhook, WebhookEvent } from '@/lib/sdk';
import { getWebhookSecret } from '@/lib/secrets';

/**
 * Event tracking record — stores webhook events for audit trail.
 * In production, replace the in-memory store with a database (KV/PostgreSQL/Redis).
 */
interface EventRecord {
  id: string;
  type: string;
  business_id: string;
  received_at: string;
  processed: boolean;
  status: 'pending' | 'awaiting_payment' | 'confirming' | 'completed' | 'expired' | 'failed' | 'refunded';
  data?: any;
}

// In-memory event store (development only — replace with persistent storage in production)
const eventStore: Map<string, EventRecord> = new Map();

/**
 * Create and track an event record from a webhook payload.
 */
function trackEvent(type: string, id: string, business_id: string, data: any): EventRecord {
  if (!type || !id) {
    throw new Error('Invalid webhook: missing required fields (type, id)');
  }

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
  console.log(`[WebhookTracker] ${type} → ${event.status} | business: ${event.business_id} | id: ${id}`);
  return event;
}

/**
 * POST /api/webhook-receiver
 *
 * Example endpoint showing how to receive and verify CoinPay webhooks
 * using the @profullstack/coinpay SDK.
 */
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

    const event = JSON.parse(rawBody);
    const { type, id, data, business_id } = event;

    // Track the event
    const record = trackEvent(type, id, business_id, data);

    // Business logic per event type
    switch (type) {
      case WebhookEvent.PAYMENT_CREATED:
        // Payment initialized — tracking record created above
        break;

      case WebhookEvent.PAYMENT_PENDING:
        // Funds detected, awaiting blockchain confirmation
        // TODO: Notify merchant that payment is pending confirmation
        break;

      case WebhookEvent.PAYMENT_CONFIRMING:
        // Payment detected on-chain, awaiting sufficient confirmations
        // TODO: Update order status to "confirming" in database
        break;

      case WebhookEvent.PAYMENT_COMPLETED:
        // Payment fully confirmed — fulfill the order
        // TODO: Trigger fulfillment workflow, send confirmation email
        console.log(`[Fulfillment] Payment completed for ${id}, business ${business_id}`);
        break;

      case WebhookEvent.PAYMENT_EXPIRED:
        // Payment window closed
        // TODO: Notify buyer that payment window expired
        break;

      case WebhookEvent.PAYMENT_FAILED:
        // Transaction failed (insufficient funds, network error)
        // TODO: Notify buyer, offer retry option
        break;

      case WebhookEvent.PAYMENT_REFUNDED:
        // Payment refunded by merchant or arbiter
        // TODO: Process refund through payment gateway
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${type}`);
    }

    // Mark processed
    record.processed = true;
    eventStore.set(id, record);

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
