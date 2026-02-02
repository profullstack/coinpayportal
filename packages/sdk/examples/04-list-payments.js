/**
 * List & Filter Payments Example
 *
 * Demonstrates listing payments with pagination and status filters.
 *
 * Usage:
 *   COINPAY_API_KEY=cp_live_xxx COINPAY_BUSINESS_ID=biz_xxx node 04-list-payments.js
 */

import { CoinPayClient, PaymentStatus } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID;

// ──────────────────────────────────────────
// List all recent payments
// ──────────────────────────────────────────
async function listRecent() {
  const { payments } = await client.listPayments({
    businessId: BUSINESS_ID,
    limit: 10,
    offset: 0,
  });

  console.log(`📋 Recent payments (${payments.length}):\n`);
  for (const p of payments) {
    console.log(`  ${p.id}  ${p.status.padEnd(12)}  ${p.amount} ${p.currency}  →  ${p.crypto_amount} ${p.blockchain}`);
  }
}

// ──────────────────────────────────────────
// List only completed payments
// ──────────────────────────────────────────
async function listCompleted() {
  const { payments } = await client.listPayments({
    businessId: BUSINESS_ID,
    status: PaymentStatus.COMPLETED,
    limit: 5,
  });

  console.log(`\n✅ Completed payments (${payments.length}):\n`);
  for (const p of payments) {
    console.log(`  ${p.id}  ${p.crypto_amount} ${p.blockchain}  tx: ${p.tx_hash || 'n/a'}`);
  }
}

// ──────────────────────────────────────────
// Paginate through all payments
// ──────────────────────────────────────────
async function paginateAll() {
  const PAGE_SIZE = 20;
  let offset = 0;
  let total = 0;

  console.log('\n📄 Paginating all payments:\n');

  while (true) {
    const { payments } = await client.listPayments({
      businessId: BUSINESS_ID,
      limit: PAGE_SIZE,
      offset,
    });

    if (payments.length === 0) break;

    total += payments.length;
    console.log(`  Page ${Math.floor(offset / PAGE_SIZE) + 1}: ${payments.length} payments`);

    if (payments.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  console.log(`\n  Total: ${total} payments`);
}

// Run
try {
  await listRecent();
  await listCompleted();
  await paginateAll();
} catch (error) {
  console.error('Error:', error.message);
}
