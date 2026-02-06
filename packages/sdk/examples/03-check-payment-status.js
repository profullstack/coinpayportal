/**
 * Payment Status Checking Examples
 *
 * Demonstrates two approaches:
 *   1. One-time status check (getPayment)
 *   2. Automatic polling until completion (waitForPayment)
 *
 * Usage:
 *   COINPAY_API_KEY=cp_live_xxx node 03-check-payment-status.js <payment-id>
 */

import { CoinPayClient, PaymentStatus } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

const PAYMENT_ID = process.argv[2];

if (!PAYMENT_ID) {
  console.error('Usage: node 03-check-payment-status.js <payment-id>');
  process.exit(1);
}

// ──────────────────────────────────────────
// Approach 1: One-time status check
// ──────────────────────────────────────────
async function checkOnce() {
  const { payment } = await client.getPayment(PAYMENT_ID);

  console.log('Payment details:');
  console.log(`  ID:         ${payment.id}`);
  console.log(`  Status:     ${payment.status}`);
  console.log(`  Amount:     ${payment.amount} ${payment.currency}`);
  console.log(`  Crypto:     ${payment.crypto_amount} ${payment.blockchain}`);
  console.log(`  Address:    ${payment.payment_address}`);
  console.log(`  Created:    ${payment.created_at}`);

  if (payment.tx_hash) {
    console.log(`  TX Hash:    ${payment.tx_hash}`);
  }

  // Check if payment is in a final state
  const finalStatuses = [
    PaymentStatus.COMPLETED,
    PaymentStatus.EXPIRED,
    PaymentStatus.FAILED,
    PaymentStatus.REFUNDED,
  ];

  if (finalStatuses.includes(payment.status)) {
    console.log(`\n✅ Payment is in a final state: ${payment.status}`);
  } else {
    console.log(`\n⏳ Payment is still in progress: ${payment.status}`);
  }

  return payment;
}

// ──────────────────────────────────────────
// Approach 2: Poll until complete
// ──────────────────────────────────────────
async function waitForCompletion() {
  console.log('\n🔄 Waiting for payment to complete...');
  console.log('   (Press Ctrl+C to stop)\n');

  try {
    const { payment } = await client.waitForPayment(PAYMENT_ID, {
      interval: 5000,        // Check every 5 seconds
      timeout: 600_000,      // Give up after 10 minutes
      onStatusChange: (status, payment) => {
        const time = new Date().toLocaleTimeString();
        console.log(`   [${time}] Status changed → ${status}`);
      },
    });

    if (payment.status === 'confirmed' || payment.status === 'forwarded') {
      console.log(`\n🎉 Payment successful! Status: ${payment.status}`);
    } else {
      console.log(`\n❌ Payment ended with status: ${payment.status}`);
    }
  } catch (error) {
    if (error.message.includes('timed out')) {
      console.log('\n⏰ Timed out waiting for payment.');
    } else {
      throw error;
    }
  }
}

// Run
try {
  await checkOnce();
  // Uncomment the line below to also wait for completion:
  // await waitForCompletion();
} catch (error) {
  console.error('Error:', error.message);
}
