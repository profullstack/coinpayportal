/**
 * Payment Creation Examples
 *
 * Shows how to create payments across all supported blockchains,
 * with metadata, and using different fiat currencies.
 *
 * Usage:
 *   COINPAY_API_KEY=cp_live_xxx COINPAY_BUSINESS_ID=biz_xxx node 02-create-payment.js
 */

import { CoinPayClient, Blockchain, FiatCurrency } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

const BUSINESS_ID = process.env.COINPAY_BUSINESS_ID;

// ──────────────────────────────────────────
// Bitcoin payment
// ──────────────────────────────────────────
async function createBitcoinPayment() {
  const { payment } = await client.createPayment({
    businessId: BUSINESS_ID,
    amount: 50.00,
    currency: FiatCurrency.USD,
    blockchain: Blockchain.BTC,
    description: 'Premium plan — monthly',
    metadata: {
      userId: 'user_abc123',
      plan: 'premium',
      period: '2024-01',
    },
  });

  console.log('Bitcoin payment:');
  console.log(`  Address: ${payment.payment_address}`);
  console.log(`  Amount:  ${payment.crypto_amount} BTC`);
  return payment;
}

// ──────────────────────────────────────────
// Ethereum payment
// ──────────────────────────────────────────
async function createEthereumPayment() {
  const { payment } = await client.createPayment({
    businessId: BUSINESS_ID,
    amount: 100.00,
    blockchain: Blockchain.ETH,
    description: 'Annual subscription',
  });

  console.log('Ethereum payment:');
  console.log(`  Address: ${payment.payment_address}`);
  console.log(`  Amount:  ${payment.crypto_amount} ETH`);
  return payment;
}

// ──────────────────────────────────────────
// USDC on Polygon (stablecoin — no price volatility)
// ──────────────────────────────────────────
async function createStablecoinPayment() {
  const { payment } = await client.createPayment({
    businessId: BUSINESS_ID,
    amount: 29.99,
    blockchain: Blockchain.USDC_POL,
    description: 'Digital download — no volatility with USDC',
  });

  console.log('USDC (Polygon) payment:');
  console.log(`  Address: ${payment.payment_address}`);
  console.log(`  Amount:  ${payment.crypto_amount} USDC`);
  return payment;
}

// ──────────────────────────────────────────
// Solana payment with EUR pricing
// ──────────────────────────────────────────
async function createSolanaEURPayment() {
  const { payment } = await client.createPayment({
    businessId: BUSINESS_ID,
    amount: 45.00,
    currency: FiatCurrency.EUR,
    blockchain: Blockchain.SOL,
    description: 'EU order #7890',
  });

  console.log('Solana (EUR) payment:');
  console.log(`  Address: ${payment.payment_address}`);
  console.log(`  Amount:  ${payment.crypto_amount} SOL`);
  return payment;
}

// ──────────────────────────────────────────
// Run all examples
// ──────────────────────────────────────────
try {
  await createBitcoinPayment();
  console.log();
  await createEthereumPayment();
  console.log();
  await createStablecoinPayment();
  console.log();
  await createSolanaEURPayment();
} catch (error) {
  console.error('Error:', error.message);
  if (error.status === 401) {
    console.error('Check your API key.');
  }
}
