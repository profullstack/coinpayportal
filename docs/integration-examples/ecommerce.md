# Integration Example: E-Commerce Checkout

Add crypto payments to an existing e-commerce checkout flow. This example shows the server-side integration pattern for any Node.js e-commerce platform (Shopify custom app, WooCommerce headless, custom cart, etc.).

---

## Architecture

```
Customer → Your Checkout → Your Backend → CoinPay API
                                ↓
                          Create Payment
                                ↓
Customer ← Show QR/Address ← Payment Details
                                ↓
                          Customer Sends Crypto
                                ↓
CoinPay Monitor → Detects Funds → Webhook → Your Backend → Fulfill Order
```

---

## Server-Side: Order + Payment Flow

```javascript
// routes/checkout.mjs
import { CoinPayClient, Blockchain } from '@profullstack/coinpay';
import { db } from '../lib/database.mjs';

const coinpay = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID;

/**
 * POST /checkout/crypto
 * Customer selected "Pay with Crypto" at checkout
 */
export async function createCryptoCheckout(req, res) {
  const { cartId, blockchain } = req.body;
  const userId = req.user.id;

  // 1. Load the cart and calculate total
  const cart = await db.carts.findById(cartId);
  if (!cart || cart.userId !== userId) {
    return res.status(404).json({ error: 'Cart not found' });
  }

  const totalUsd = cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);

  // 2. Create order in your database (status: awaiting_payment)
  const order = await db.orders.create({
    userId,
    cartId,
    totalUsd,
    paymentMethod: 'crypto',
    paymentBlockchain: blockchain,
    status: 'awaiting_payment',
  });

  // 3. Create CoinPay payment
  const result = await coinpay.createPayment({
    businessId: BUSINESS_ID,
    amount: totalUsd,
    currency: 'USD',
    blockchain,
    description: `Order #${order.id}`,
    metadata: {
      orderId: order.id,
      userId,
      items: cart.items.map(i => ({ sku: i.sku, qty: i.qty })),
    },
  });

  const payment = result.payment;

  // 4. Link CoinPay payment to your order
  await db.orders.update(order.id, {
    coinpayPaymentId: payment.id,
    paymentAddress: payment.payment_address,
    cryptoAmount: payment.crypto_amount || payment.amount_crypto,
    expiresAt: payment.expires_at,
  });

  // 5. Return payment details to frontend
  res.json({
    orderId: order.id,
    paymentId: payment.id,
    address: payment.payment_address,
    cryptoAmount: payment.crypto_amount || payment.amount_crypto,
    blockchain,
    expiresAt: payment.expires_at,
    qrUrl: coinpay.getPaymentQRUrl(payment.id),
    statusUrl: `/orders/${order.id}/status`,
  });
}

/**
 * GET /orders/:id/status
 * Frontend polls this while customer is paying
 */
export async function getOrderStatus(req, res) {
  const order = await db.orders.findById(req.params.id);
  if (!order || order.userId !== req.user.id) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json({
    orderId: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalUsd: order.totalUsd,
    cryptoAmount: order.cryptoAmount,
    blockchain: order.paymentBlockchain,
  });
}
```

---

## Webhook Handler: Fulfill on Confirmation

```javascript
// routes/webhooks.mjs
import { verifyWebhookSignature, parseWebhookPayload } from '@profullstack/coinpay';
import { db } from '../lib/database.mjs';
import { sendOrderConfirmationEmail } from '../lib/email.mjs';
import { shipOrder } from '../lib/fulfillment.mjs';

const WEBHOOK_SECRET = process.env.COINPAY_WEBHOOK_SECRET;

/**
 * POST /webhooks/coinpay
 * Handle payment lifecycle events
 */
export async function handleWebhook(req, res) {
  // 1. Verify signature (use raw body!)
  const signature = req.headers['x-coinpay-signature'];
  const rawBody = req.rawBody || req.body.toString();

  const isValid = verifyWebhookSignature({
    payload: rawBody,
    signature,
    secret: WEBHOOK_SECRET,
  });

  if (!isValid) {
    console.warn('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. Parse event
  const event = parseWebhookPayload(rawBody);
  const { payment_id, amount_usd, amount_crypto, currency, metadata } = event.data;
  const orderId = metadata?.orderId;

  console.log(`Webhook: ${event.type} for payment ${payment_id} (order ${orderId})`);

  // 3. Find the order
  if (!orderId) {
    console.warn('Webhook missing orderId in metadata');
    return res.json({ received: true });
  }

  const order = await db.orders.findById(orderId);
  if (!order) {
    console.warn(`Order ${orderId} not found for payment ${payment_id}`);
    return res.json({ received: true });
  }

  // 4. Idempotency check — don't process the same event twice
  const alreadyProcessed = await db.webhookEvents.exists(event.id);
  if (alreadyProcessed) {
    return res.json({ received: true, duplicate: true });
  }
  await db.webhookEvents.create({ eventId: event.id, type: event.type, orderId });

  // 5. Handle event
  switch (event.type) {
    case 'payment.confirmed': {
      await db.orders.update(orderId, {
        status: 'paid',
        paymentStatus: 'confirmed',
        paidAt: new Date(),
      });

      // Send confirmation email
      await sendOrderConfirmationEmail(order.userId, orderId, {
        amountUsd: amount_usd,
        amountCrypto: amount_crypto,
        currency,
      });

      // Start fulfillment for digital goods
      if (order.isDigital) {
        await shipOrder(orderId);
        await db.orders.update(orderId, { status: 'fulfilled' });
      }
      break;
    }

    case 'payment.forwarded': {
      // Funds have been forwarded to your wallet
      await db.orders.update(orderId, {
        paymentStatus: 'forwarded',
        forwardedAt: new Date(),
      });
      break;
    }

    case 'payment.expired': {
      // Only update if order hasn't been paid yet
      if (order.status === 'awaiting_payment') {
        await db.orders.update(orderId, {
          status: 'expired',
          paymentStatus: 'expired',
        });
        // Optionally: release reserved inventory
        await db.inventory.release(orderId);
      }
      break;
    }

    case 'payment.failed': {
      await db.orders.update(orderId, {
        paymentStatus: 'failed',
        failedAt: new Date(),
      });
      // Alert the operations team
      console.error(`Payment failed for order ${orderId}`);
      break;
    }
  }

  res.json({ received: true });
}
```

---

## Express App Wiring

```javascript
// app.mjs
import express from 'express';
import { createCryptoCheckout, getOrderStatus } from './routes/checkout.mjs';
import { handleWebhook } from './routes/webhooks.mjs';

const app = express();

// Webhook route MUST use raw body for signature verification
app.post('/webhooks/coinpay', express.raw({ type: 'application/json' }), handleWebhook);

// Regular routes use JSON parsing
app.use(express.json());
app.post('/checkout/crypto', createCryptoCheckout);
app.get('/orders/:id/status', getOrderStatus);

app.listen(3000);
```

> ⚠️ **Important:** The webhook route must parse the body as raw (not JSON) for signature verification to work. Define it before `express.json()` middleware.

---

## Database Schema (Example)

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  cart_id UUID NOT NULL,
  total_usd NUMERIC(10, 2) NOT NULL,
  payment_method TEXT DEFAULT 'crypto',
  payment_blockchain TEXT,
  coinpay_payment_id TEXT,
  payment_address TEXT,
  crypto_amount TEXT,
  status TEXT DEFAULT 'awaiting_payment',
  payment_status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  forwarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotency table for webhooks
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id UUID REFERENCES orders(id),
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_coinpay_payment ON orders(coinpay_payment_id);
CREATE INDEX idx_orders_status ON orders(status);
```

---

## Checklist for Production

- [ ] Store webhook events for idempotency (don't fulfill twice)
- [ ] Set up webhook retry handling (CoinPay retries failed deliveries)
- [ ] Monitor `payment.failed` events and alert your ops team
- [ ] Reserve inventory when payment is created, release on expiry
- [ ] Set reasonable payment expiry times (30-60 minutes for crypto)
- [ ] Test with small amounts before going live
- [ ] Log all webhook events for debugging
- [ ] Verify webhook signatures on every request — no exceptions
