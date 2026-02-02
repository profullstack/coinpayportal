/**
 * Quick Start Example
 *
 * Demonstrates the simplest way to create a payment and check its status.
 *
 * Usage:
 *   COINPAY_API_KEY=cp_live_xxx COINPAY_BUSINESS_ID=biz_xxx node 01-quick-start.js
 */

import { CoinPayClient, Blockchain } from '@profullstack/coinpay';

const API_KEY = process.env.COINPAY_API_KEY;
const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID;

if (!API_KEY || !BUSINESS_ID) {
  console.error('Set COINPAY_API_KEY and COINPAY_BUSINESS_ID environment variables');
  process.exit(1);
}

// 1. Create a client
const client = new CoinPayClient({ apiKey: API_KEY });

// 2. Create a payment
const { payment } = await client.createPayment({
  businessId: BUSINESS_ID,
  amount: 25.00,
  currency: 'USD',
  blockchain: Blockchain.BTC,
  description: 'Quick start example payment',
  metadata: { example: true },
});

console.log('✅ Payment created!');
console.log(`   ID:      ${payment.id}`);
console.log(`   Address: ${payment.payment_address}`);
console.log(`   Amount:  ${payment.crypto_amount} BTC`);
console.log(`   Status:  ${payment.status}`);
console.log(`   Expires: ${payment.expires_at}`);

// 3. Check the payment status
const result = await client.getPayment(payment.id);
console.log(`\n📋 Current status: ${result.payment.status}`);
