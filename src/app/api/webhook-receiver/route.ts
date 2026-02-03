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
 *   const payload = req.body.toString(); // Raw body as string
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
 *   // Parse and process the webhook event
 *   const event = parseWebhookPayload(payload);
 *
 *   switch (event.type) {
 *     case WebhookEvent.PAYMENT_COMPLETED:
 *       // Handle completed payment
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

/**
 * POST /api/webhook-receiver
 *
 * Example endpoint showing how to receive and verify CoinPay webhooks
 * using the @profullstack/coinpay SDK.
 *
 * Note: The SDK expects the raw request body as a string for signature verification.
 */
export async function POST(request: NextRequest) {
  try {
    // Get the webhook signature from headers
    // The SDK uses 'x-coinpay-signature' header
    const signature = request.headers.get('x-coinpay-signature');

    if (!signature) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing X-CoinPay-Signature header',
        },
        { status: 401 }
      );
    }

    // Get the raw request body as a string (required for signature verification)
    const rawBody = await request.text();

    // Get the webhook secret from environment
    // In production, this would be the secret provided when configuring webhooks
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('WEBHOOK_SECRET environment variable is not set');
      return NextResponse.json(
        { success: false, error: 'Webhook receiver not configured' },
        { status: 500 }
      );
    }

    // Verify the webhook signature using the SDK
    // The SDK expects: payload (string), signature (format: t=timestamp,v1=hash), secret
    const isValid = verifyIncomingWebhook(rawBody, signature, webhookSecret);

    if (!isValid) {
      console.warn('Invalid webhook signature received');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid webhook signature',
        },
        { status: 401 }
      );
    }

    // Parse the verified payload
    const event = JSON.parse(rawBody);
    const { type, id, data, business_id } = event;

    console.log(`Received webhook: ${type} (${id}) for business ${business_id}`);

    // Process the webhook event using SDK's WebhookEvent constants
    switch (type) {
      case WebhookEvent.PAYMENT_CREATED:
        console.log('Payment created:', data);
        // TODO: Initialize order tracking
        break;

      case WebhookEvent.PAYMENT_PENDING:
        console.log('Payment pending:', data);
        // TODO: Update order status to "awaiting payment"
        break;

      case WebhookEvent.PAYMENT_CONFIRMING:
        console.log('Payment confirming:', data);
        // TODO: Update order status to "payment detected, awaiting confirmations"
        break;

      case WebhookEvent.PAYMENT_COMPLETED:
        console.log('Payment completed:', data);
        // TODO: Fulfill the order, send confirmation email, etc.
        break;

      case WebhookEvent.PAYMENT_EXPIRED:
        console.log('Payment expired:', data);
        // TODO: Cancel order, notify customer
        break;

      case WebhookEvent.PAYMENT_FAILED:
        console.log('Payment failed:', data);
        // TODO: Handle failed payment, notify customer
        break;

      case WebhookEvent.PAYMENT_REFUNDED:
        console.log('Payment refunded:', data);
        // TODO: Process refund, update records
        break;

      case WebhookEvent.BUSINESS_CREATED:
        console.log('Business created:', data);
        break;

      case WebhookEvent.BUSINESS_UPDATED:
        console.log('Business updated:', data);
        break;

      default:
        console.warn(`Unknown webhook event type: ${type}`);
    }

    // Acknowledge receipt of the webhook
    return NextResponse.json(
      {
        success: true,
        received: true,
        event_type: type,
        event_id: id,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}