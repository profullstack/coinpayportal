/**
 * Business Management Example
 *
 * Demonstrates creating, listing, and updating businesses
 * via the CoinPay API.
 *
 * Usage:
 *   COINPAY_API_KEY=cp_live_xxx node 08-business-management.js
 */

import { CoinPayClient } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

// ──────────────────────────────────────────
// List existing businesses
// ──────────────────────────────────────────
async function listBusinesses() {
  const result = await client.listBusinesses();
  console.log('Your businesses:');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// ──────────────────────────────────────────
// Create a new business
// ──────────────────────────────────────────
async function createBusiness() {
  const result = await client.createBusiness({
    name: 'My Online Store',
    webhookUrl: 'https://mystore.com/webhook/coinpay',
    walletAddresses: {
      BTC: 'bc1q...',
      ETH: '0x...',
      SOL: '...',
    },
  });

  console.log('\nBusiness created:');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// ──────────────────────────────────────────
// Update a business
// ──────────────────────────────────────────
async function updateBusiness(businessId) {
  const result = await client.updateBusiness(businessId, {
    name: 'My Online Store (Updated)',
    webhookUrl: 'https://mystore.com/webhook/coinpay/v2',
  });

  console.log('\nBusiness updated:');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// ──────────────────────────────────────────
// Get a single business
// ──────────────────────────────────────────
async function getBusiness(businessId) {
  const result = await client.getBusiness(businessId);
  console.log('\nBusiness details:');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// Run
try {
  await listBusinesses();
  // Uncomment to create / update:
  // const biz = await createBusiness();
  // await updateBusiness(biz.business.id);
  // await getBusiness(biz.business.id);
} catch (error) {
  console.error('Error:', error.message);
}
