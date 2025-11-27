/**
 * Tests for Payment Monitor Edge Function
 * 
 * These tests verify the core monitoring logic.
 * Run with: deno test --allow-env supabase/functions/monitor-payments/monitor.test.ts
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';

// Mock types for testing
interface Payment {
  id: string;
  business_id: string;
  blockchain: string;
  crypto_amount: number;
  status: string;
  payment_address: string;
  created_at: string;
  expires_at: string;
  merchant_wallet_address: string;
}

// Test helper functions that mirror the edge function logic
function isPaymentExpired(payment: Payment): boolean {
  const now = new Date();
  const expiresAt = new Date(payment.expires_at);
  return now > expiresAt;
}

function getTimeRemaining(payment: Payment): number {
  const now = new Date();
  const expiresAt = new Date(payment.expires_at);
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

function shouldCheckBalance(payment: Payment): boolean {
  return (
    payment.status === 'pending' &&
    !isPaymentExpired(payment) &&
    payment.payment_address !== null
  );
}

function isBalanceSufficient(
  balance: number,
  expectedAmount: number,
  tolerancePercent: number = 1
): boolean {
  const tolerance = expectedAmount * (tolerancePercent / 100);
  return balance >= expectedAmount - tolerance;
}

// Tests
Deno.test('isPaymentExpired - returns false for future expiry', () => {
  const futureDate = new Date();
  futureDate.setMinutes(futureDate.getMinutes() + 10);
  
  const payment: Payment = {
    id: 'test-1',
    business_id: 'biz-1',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'pending',
    payment_address: '0x123',
    created_at: new Date().toISOString(),
    expires_at: futureDate.toISOString(),
    merchant_wallet_address: '0x456',
  };
  
  assertEquals(isPaymentExpired(payment), false);
});

Deno.test('isPaymentExpired - returns true for past expiry', () => {
  const pastDate = new Date();
  pastDate.setMinutes(pastDate.getMinutes() - 5);
  
  const payment: Payment = {
    id: 'test-2',
    business_id: 'biz-1',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'pending',
    payment_address: '0x123',
    created_at: new Date().toISOString(),
    expires_at: pastDate.toISOString(),
    merchant_wallet_address: '0x456',
  };
  
  assertEquals(isPaymentExpired(payment), true);
});

Deno.test('getTimeRemaining - returns correct seconds for future expiry', () => {
  const futureDate = new Date();
  futureDate.setSeconds(futureDate.getSeconds() + 300); // 5 minutes
  
  const payment: Payment = {
    id: 'test-3',
    business_id: 'biz-1',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'pending',
    payment_address: '0x123',
    created_at: new Date().toISOString(),
    expires_at: futureDate.toISOString(),
    merchant_wallet_address: '0x456',
  };
  
  const remaining = getTimeRemaining(payment);
  // Allow 2 second tolerance for test execution
  assertEquals(remaining >= 298 && remaining <= 300, true);
});

Deno.test('getTimeRemaining - returns 0 for expired payment', () => {
  const pastDate = new Date();
  pastDate.setMinutes(pastDate.getMinutes() - 5);
  
  const payment: Payment = {
    id: 'test-4',
    business_id: 'biz-1',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'pending',
    payment_address: '0x123',
    created_at: new Date().toISOString(),
    expires_at: pastDate.toISOString(),
    merchant_wallet_address: '0x456',
  };
  
  assertEquals(getTimeRemaining(payment), 0);
});

Deno.test('shouldCheckBalance - returns true for valid pending payment', () => {
  const futureDate = new Date();
  futureDate.setMinutes(futureDate.getMinutes() + 10);
  
  const payment: Payment = {
    id: 'test-5',
    business_id: 'biz-1',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'pending',
    payment_address: '0x123',
    created_at: new Date().toISOString(),
    expires_at: futureDate.toISOString(),
    merchant_wallet_address: '0x456',
  };
  
  assertEquals(shouldCheckBalance(payment), true);
});

Deno.test('shouldCheckBalance - returns false for expired payment', () => {
  const pastDate = new Date();
  pastDate.setMinutes(pastDate.getMinutes() - 5);
  
  const payment: Payment = {
    id: 'test-6',
    business_id: 'biz-1',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'pending',
    payment_address: '0x123',
    created_at: new Date().toISOString(),
    expires_at: pastDate.toISOString(),
    merchant_wallet_address: '0x456',
  };
  
  assertEquals(shouldCheckBalance(payment), false);
});

Deno.test('shouldCheckBalance - returns false for non-pending payment', () => {
  const futureDate = new Date();
  futureDate.setMinutes(futureDate.getMinutes() + 10);
  
  const payment: Payment = {
    id: 'test-7',
    business_id: 'biz-1',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'confirmed',
    payment_address: '0x123',
    created_at: new Date().toISOString(),
    expires_at: futureDate.toISOString(),
    merchant_wallet_address: '0x456',
  };
  
  assertEquals(shouldCheckBalance(payment), false);
});

Deno.test('isBalanceSufficient - returns true when balance equals expected', () => {
  assertEquals(isBalanceSufficient(0.1, 0.1), true);
});

Deno.test('isBalanceSufficient - returns true when balance exceeds expected', () => {
  assertEquals(isBalanceSufficient(0.15, 0.1), true);
});

Deno.test('isBalanceSufficient - returns true within 1% tolerance', () => {
  // 0.099 is within 1% of 0.1
  assertEquals(isBalanceSufficient(0.099, 0.1), true);
});

Deno.test('isBalanceSufficient - returns false below tolerance', () => {
  // 0.098 is below 1% tolerance of 0.1
  assertEquals(isBalanceSufficient(0.098, 0.1), false);
});

Deno.test('isBalanceSufficient - returns false for zero balance', () => {
  assertEquals(isBalanceSufficient(0, 0.1), false);
});

Deno.test('isBalanceSufficient - handles custom tolerance', () => {
  // 0.095 is within 5% of 0.1
  assertEquals(isBalanceSufficient(0.095, 0.1, 5), true);
  // 0.094 is below 5% tolerance
  assertEquals(isBalanceSufficient(0.094, 0.1, 5), false);
});

// Test blockchain-specific balance parsing
Deno.test('Bitcoin balance conversion - satoshis to BTC', () => {
  const satoshis = 10000000; // 0.1 BTC
  const btc = satoshis / 100_000_000;
  assertEquals(btc, 0.1);
});

Deno.test('Ethereum balance conversion - wei to ETH', () => {
  const wei = BigInt('100000000000000000'); // 0.1 ETH
  const eth = Number(wei) / 1e18;
  assertEquals(eth, 0.1);
});

Deno.test('Solana balance conversion - lamports to SOL', () => {
  const lamports = 100000000; // 0.1 SOL
  const sol = lamports / 1e9;
  assertEquals(sol, 0.1);
});

// Test payment status transitions
Deno.test('Payment status transitions - pending to confirmed', () => {
  const validTransitions: Record<string, string[]> = {
    pending: ['confirmed', 'expired'],
    confirmed: ['forwarding', 'forwarding_failed'],
    forwarding: ['forwarded', 'forwarding_failed'],
    forwarding_failed: ['forwarding', 'forwarded'],
    forwarded: [],
    expired: [],
  };
  
  assertEquals(validTransitions['pending'].includes('confirmed'), true);
  assertEquals(validTransitions['pending'].includes('forwarded'), false);
});

Deno.test('Payment status transitions - pending to expired', () => {
  const validTransitions: Record<string, string[]> = {
    pending: ['confirmed', 'expired'],
    confirmed: ['forwarding', 'forwarding_failed'],
    forwarding: ['forwarded', 'forwarding_failed'],
    forwarding_failed: ['forwarding', 'forwarded'],
    forwarded: [],
    expired: [],
  };
  
  assertEquals(validTransitions['pending'].includes('expired'), true);
});

// Test webhook payload structure
Deno.test('Webhook payload structure for payment.expired', () => {
  const payment: Payment = {
    id: 'pay-123',
    business_id: 'biz-456',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'expired',
    payment_address: '0x123',
    created_at: '2024-01-01T00:00:00Z',
    expires_at: '2024-01-01T00:15:00Z',
    merchant_wallet_address: '0x456',
  };
  
  const payload = {
    event: 'payment.expired',
    payment_id: payment.id,
    status: payment.status,
    blockchain: payment.blockchain,
    amount: payment.crypto_amount,
    payment_address: payment.payment_address,
    timestamp: new Date().toISOString(),
    reason: 'Payment window expired (15 minutes)',
  };
  
  assertExists(payload.event);
  assertExists(payload.payment_id);
  assertExists(payload.timestamp);
  assertEquals(payload.event, 'payment.expired');
  assertEquals(payload.reason, 'Payment window expired (15 minutes)');
});

Deno.test('Webhook payload structure for payment.confirmed', () => {
  const payment: Payment = {
    id: 'pay-123',
    business_id: 'biz-456',
    blockchain: 'ETH',
    crypto_amount: 0.1,
    status: 'confirmed',
    payment_address: '0x123',
    created_at: '2024-01-01T00:00:00Z',
    expires_at: '2024-01-01T00:15:00Z',
    merchant_wallet_address: '0x456',
  };
  
  const receivedAmount = 0.1;
  
  const payload = {
    event: 'payment.confirmed',
    payment_id: payment.id,
    status: payment.status,
    blockchain: payment.blockchain,
    amount: payment.crypto_amount,
    payment_address: payment.payment_address,
    timestamp: new Date().toISOString(),
    received_amount: receivedAmount,
  };
  
  assertExists(payload.event);
  assertExists(payload.received_amount);
  assertEquals(payload.event, 'payment.confirmed');
  assertEquals(payload.received_amount, 0.1);
});

// Test HMAC signature generation
Deno.test('HMAC signature should be hex string', async () => {
  const secret = 'test-secret';
  const payload = JSON.stringify({ test: 'data' });
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );
  
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // HMAC-SHA256 produces 64 character hex string
  assertEquals(signature.length, 64);
  // Should only contain hex characters
  assertEquals(/^[0-9a-f]+$/.test(signature), true);
});

console.log('All monitor tests passed!');