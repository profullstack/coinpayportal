/**
 * Webhook Handler Example
 *
 * Express server that receives and verifies CoinPay webhook events.
 * Shows both the middleware approach and manual verification.
 *
 * Usage:
 *   npm install express
 *   COINPAY_WEBHOOK_SECRET=whsec_xxx node 06-webhook-handler.js
 *
 * Test with:
 *   Use the CoinPay dashboard "Test webhook" button, or:
 *   coinpay webhook test <business-id>
 */

import express from 'express';
import {
  createWebhookHandler,
  verifyWebhookSignature,
  parseWebhookPayload,
  WebhookEvent,
} from '@profullstack/coinpay';

const app = express();
const WEBHOOK_SECRET = process.env.COINPAY_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  console.error('Set COINPAY_WEBHOOK_SECRET environment variable');
  process.exit(1);
}

// ──────────────────────────────────────────
// Approach 1: Using the built-in middleware (recommended)
// ──────────────────────────────────────────

// IMPORTANT: Use express.raw() or express.text() so the body arrives as a
// string for signature verification. express.json() parses it first, which
// changes the byte representation and breaks HMAC validation.
app.post(
  '/webhook',
  express.text({ type: 'application/json' }),
  createWebhookHandler({
    secret: WEBHOOK_SECRET,
    onEvent: async (event) => {
      console.log(`\n📩 Received event: ${event.type}`);
      console.log(`   Event ID:    ${event.id}`);
      console.log(`   Business:    ${event.businessId}`);
      console.log(`   Timestamp:   ${event.createdAt.toISOString()}`);

      switch (event.type) {
        case WebhookEvent.PAYMENT_COMPLETED:
          console.log('   ✅ Payment confirmed! Fulfill the order.');
          console.log('   Data:', JSON.stringify(event.data, null, 2));
          // await fulfillOrder(event.data.payment.metadata.orderId);
          break;

        case WebhookEvent.PAYMENT_EXPIRED:
          console.log('   ⏰ Payment expired. Notify the customer.');
          break;

        case WebhookEvent.PAYMENT_FAILED:
          console.log('   ❌ Payment failed.');
          break;

        default:
          console.log(`   ℹ️  Unhandled event type: ${event.type}`);
      }
    },
    onError: (error) => {
      console.error('Webhook handler error:', error.message);
    },
  })
);

// ──────────────────────────────────────────
// Approach 2: Manual verification (for custom frameworks)
// ──────────────────────────────────────────
app.post(
  '/webhook-manual',
  express.text({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-coinpay-signature'];
    const rawBody = req.body;

    // Step 1: Verify signature
    const isValid = verifyWebhookSignature({
      payload: rawBody,
      signature,
      secret: WEBHOOK_SECRET,
    });

    if (!isValid) {
      console.warn('⚠️  Invalid webhook signature — rejecting');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Step 2: Parse the event
    const event = parseWebhookPayload(rawBody);

    // Step 3: Process it
    console.log(`\n📩 [manual] Event: ${event.type}`);

    // Always respond 200 quickly to avoid retries
    res.status(200).json({ received: true });

    // Do async work after responding
    // await processEvent(event);
  }
);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
  console.log(`   POST http://localhost:${PORT}/webhook`);
  console.log(`   POST http://localhost:${PORT}/webhook-manual`);
});
