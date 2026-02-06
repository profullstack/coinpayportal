/**
 * Error Handling Example
 *
 * Demonstrates how to handle various error types returned by the
 * CoinPay API: auth errors, validation errors, rate limits, timeouts.
 *
 * Usage:
 *   COINPAY_API_KEY=cp_live_xxx node 09-error-handling.js
 */

import { CoinPayClient, Blockchain } from '@profullstack/coinpay';

// ──────────────────────────────────────────
// Auth error (invalid API key)
// ──────────────────────────────────────────
async function testAuthError() {
  const badClient = new CoinPayClient({ apiKey: 'cp_live_invalid_key' });

  try {
    await badClient.listBusinesses();
  } catch (error) {
    console.log('Auth error:');
    console.log(`  Status:  ${error.status}`);      // 401
    console.log(`  Message: ${error.message}`);
    console.log(`  Response: ${JSON.stringify(error.response)}`);
    console.log();
  }
}

// ──────────────────────────────────────────
// Validation error (missing required fields)
// ──────────────────────────────────────────
async function testValidationError() {
  const client = new CoinPayClient({ apiKey: process.env.COINPAY_API_KEY });

  try {
    // Missing businessId and blockchain
    await client.createPayment({
      businessId: '',
      amount: 100,
      blockchain: '',
    });
  } catch (error) {
    console.log('Validation error:');
    console.log(`  Status:  ${error.status}`);      // 400
    console.log(`  Message: ${error.message}`);
    console.log(`  Details: ${JSON.stringify(error.response)}`);
    console.log();
  }
}

// ──────────────────────────────────────────
// Rate limit error
// ──────────────────────────────────────────
async function testRateLimit() {
  const client = new CoinPayClient({ apiKey: process.env.COINPAY_API_KEY });

  try {
    await client.createPayment({
      businessId: 'biz_123',
      amount: 10,
      blockchain: Blockchain.BTC,
    });
  } catch (error) {
    if (error.status === 429) {
      console.log('Rate limit hit:');
      console.log(`  Usage: ${JSON.stringify(error.response?.usage)}`);
      console.log(`  Retry after cooling down or upgrading your plan.`);
      console.log();
    } else {
      throw error;
    }
  }
}

// ──────────────────────────────────────────
// Timeout error
// ──────────────────────────────────────────
async function testTimeout() {
  // Set an impossibly short timeout
  const client = new CoinPayClient({
    apiKey: process.env.COINPAY_API_KEY,
    timeout: 1, // 1ms — will almost certainly timeout
  });

  try {
    await client.listBusinesses();
  } catch (error) {
    console.log('Timeout error:');
    console.log(`  Message: ${error.message}`);
    console.log();
  }
}

// ──────────────────────────────────────────
// Constructor error (no API key)
// ──────────────────────────────────────────
function testConstructorError() {
  try {
    new CoinPayClient({ apiKey: '' });
  } catch (error) {
    console.log('Constructor error:');
    console.log(`  Message: ${error.message}`);  // "API key is required"
    console.log();
  }
}

// ──────────────────────────────────────────
// Robust wrapper pattern
// ──────────────────────────────────────────
async function robustPayment(client, params) {
  try {
    return await client.createPayment(params);
  } catch (error) {
    switch (error.status) {
      case 400:
        console.error('Bad request — check your parameters:', error.response?.error);
        break;
      case 401:
        console.error('Authentication failed — check your API key');
        break;
      case 404:
        console.error('Business not found — check your business ID');
        break;
      case 429:
        console.error('Rate limit exceeded:', error.response?.usage);
        // Optionally: schedule a retry
        break;
      default:
        console.error('Unexpected error:', error.message);
    }
    return null;
  }
}

// Run
console.log('=== Error Handling Examples ===\n');
testConstructorError();
await testAuthError();
await testValidationError();
await testTimeout();
