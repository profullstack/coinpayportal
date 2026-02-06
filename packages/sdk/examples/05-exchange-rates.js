/**
 * Exchange Rates Example
 *
 * Demonstrates fetching single and batch exchange rates.
 *
 * Usage:
 *   COINPAY_API_KEY=cp_live_xxx node 05-exchange-rates.js
 */

import { CoinPayClient, Blockchain } from '@profullstack/coinpay';

const client = new CoinPayClient({
  apiKey: process.env.COINPAY_API_KEY,
});

// ──────────────────────────────────────────
// Get a single exchange rate
// ──────────────────────────────────────────
async function singleRate() {
  const rate = await client.getExchangeRate(Blockchain.BTC, 'USD');
  console.log('Bitcoin rate:', rate);
}

// ──────────────────────────────────────────
// Get batch rates for all supported cryptos
// ──────────────────────────────────────────
async function batchRates() {
  const allChains = Object.values(Blockchain);
  const rates = await client.getExchangeRates(allChains, 'USD');
  console.log('\nAll exchange rates (USD):');
  console.log(JSON.stringify(rates, null, 2));
}

// ──────────────────────────────────────────
// Convert fiat amount to crypto
// ──────────────────────────────────────────
async function convertAmount() {
  const fiatAmount = 100; // $100
  const rate = await client.getExchangeRate(Blockchain.ETH, 'USD');

  // rate.rate is the price of 1 ETH in USD
  if (rate.rate) {
    const ethAmount = fiatAmount / rate.rate;
    console.log(`\n$${fiatAmount} USD = ${ethAmount.toFixed(6)} ETH (at $${rate.rate}/ETH)`);
  }
}

// Run
try {
  await singleRate();
  await batchRates();
  await convertAmount();
} catch (error) {
  console.error('Error:', error.message);
}
