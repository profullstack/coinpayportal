// @vitest-environment node
/**
 * Webhook signature contract test — locks the wire format together so
 * server (sendPaymentWebhook), the SDK (verifyWebhookSignature), and
 * any merchant verifier (e.g. d0rz's verifyCoinpayWebhook) can never
 * drift apart silently.
 *
 * Background: in the d0rz incident the server was signing with the
 * AES-encrypted ciphertext of webhook_secret instead of the plaintext,
 * and one of the rails was missing checkout.session.completed from its
 * subscription. Both bugs would have been caught immediately if a
 * sign→verify round-trip lived in CI.
 *
 * Wire format (do not change without bumping the version + telling
 * every downstream merchant):
 *   header: X-CoinPay-Signature: t=<unix_seconds>,v1=<hex_hmac>
 *   hmac body: `${timestamp}.${rawBody}`
 *   algorithm: HMAC-SHA256
 *   timestamp tolerance: 300 seconds
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { signWebhookPayload } from './service';

// Inlined copy of the d0rz verifier (lib/coinpay-client.ts), so this
// test fails the moment the contract drifts even if d0rz isn't checked
// in alongside.
function verifyAsD0rz(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  try {
    const parts = signatureHeader.split(',');
    const tPart = parts.find((p) => p.startsWith('t='));
    const vPart = parts.find((p) => p.startsWith('v1='));
    if (!tPart || !vPart) return false;
    const timestamp = tPart.slice(2);
    const sig = vPart.slice(3);
    const ts = parseInt(timestamp, 10);
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (sig.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return mismatch === 0;
  } catch {
    return false;
  }
}

// Inlined copy of the SDK verifier (packages/sdk/src/webhooks.js).
function verifyAsSDK(payload: string, signature: string, secret: string): boolean {
  try {
    const parts = signature.split(',');
    const map: Record<string, string> = {};
    for (const p of parts) {
      const [k, v] = p.split('=');
      map[k] = v;
    }
    const t = map.t;
    const v1 = map.v1;
    if (!t || !v1) return false;
    const age = Math.floor(Date.now() / 1000) - parseInt(t, 10);
    if (Math.abs(age) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    if (expected.length !== v1.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
    return mismatch === 0;
  } catch {
    return false;
  }
}

const SECRET = 'whsecret_d0rzTestSecretValueForContractAssertion';

const SAMPLE_PAYLOAD = {
  id: 'evt_pay_d084f959_1775551263',
  type: 'payment.confirmed' as const,
  data: {
    payment_id: 'd084f959-c33c-4540-82b8-221181347639',
    status: 'confirmed',
    amount_usd: 1,
    amount_crypto: null,
    currency: 'usd',
    confirmations: 1,
    payment_address: null,
    tx_hash: 'pi_3TJVBwIUPdY6g4d00SkSCQ24',
    metadata: {
      payment_rail: 'card',
      stripe_session_id: 'cs_live_a1lXmhFRUinx7mSz8r5jVuxLqjmizD15QEFmL6BpQqNzHYLeKZH0caq2mS',
      stripe_payment_intent_id: 'pi_3TJVBwIUPdY6g4d00SkSCQ24',
    },
  },
  created_at: '2026-04-07T08:44:50.186Z',
  business_id: 'b198c6dc-4c3b-4a54-994c-a750c1a580cd',
};

describe('webhook signature contract — server ↔ SDK ↔ d0rz', () => {
  it('signWebhookPayload header is exactly t=<seconds>,v1=<hex sha256>', () => {
    const ts = 1775551263;
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, ts);
    expect(sig).toMatch(/^t=1775551263,v1=[0-9a-f]{64}$/);
  });

  it('hmac body is exactly `${ts}.${JSON.stringify(payload)}` (no whitespace, no key reordering)', () => {
    const ts = 1775551263;
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, ts);
    const v1 = sig.split(',')[1].slice(3);
    const expected = createHmac('sha256', SECRET)
      .update(`${ts}.${JSON.stringify(SAMPLE_PAYLOAD)}`)
      .digest('hex');
    expect(v1).toBe(expected);
  });

  it('SDK verifier accepts a server-signed payload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, ts);
    const ok = verifyAsSDK(JSON.stringify(SAMPLE_PAYLOAD), sig, SECRET);
    expect(ok).toBe(true);
  });

  it('d0rz verifier (verifyCoinpayWebhook) accepts a server-signed payload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, ts);
    const ok = verifyAsD0rz(JSON.stringify(SAMPLE_PAYLOAD), sig, SECRET);
    expect(ok).toBe(true);
  });

  it('SDK and d0rz verifiers reject a tampered payload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, ts);
    const tampered = JSON.stringify({ ...SAMPLE_PAYLOAD, data: { ...SAMPLE_PAYLOAD.data, amount_usd: 999999 } });
    expect(verifyAsSDK(tampered, sig, SECRET)).toBe(false);
    expect(verifyAsD0rz(tampered, sig, SECRET)).toBe(false);
  });

  it('SDK and d0rz verifiers reject a wrong-secret signature', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, ts);
    const body = JSON.stringify(SAMPLE_PAYLOAD);
    expect(verifyAsSDK(body, sig, 'WRONG_SECRET')).toBe(false);
    expect(verifyAsD0rz(body, sig, 'WRONG_SECRET')).toBe(false);
  });

  it('SDK and d0rz verifiers reject a stale (>300s old) timestamp', () => {
    const stale = Math.floor(Date.now() / 1000) - 400;
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, stale);
    const body = JSON.stringify(SAMPLE_PAYLOAD);
    expect(verifyAsSDK(body, sig, SECRET)).toBe(false);
    expect(verifyAsD0rz(body, sig, SECRET)).toBe(false);
  });

  it('SDK and d0rz verifiers reject a missing v1=', () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(SAMPLE_PAYLOAD);
    const headerNoV1 = `t=${ts}`;
    expect(verifyAsSDK(body, headerNoV1, SECRET)).toBe(false);
    expect(verifyAsD0rz(body, headerNoV1, SECRET)).toBe(false);
  });

  it('SDK and d0rz verifiers reject a missing t=', () => {
    const body = JSON.stringify(SAMPLE_PAYLOAD);
    const fakeHex = 'a'.repeat(64);
    const headerNoT = `v1=${fakeHex}`;
    expect(verifyAsSDK(body, headerNoT, SECRET)).toBe(false);
    expect(verifyAsD0rz(body, headerNoT, SECRET)).toBe(false);
  });

  it('reproduces the exact d0rz incident shape (raw plaintext secret, payment.confirmed)', () => {
    // This is the byte-for-byte payload that production now sends to
    // d0rz/api/webhooks/coinpay/crypto. If this assertion ever fails,
    // every CoinPay merchant who verifies HMAC will start rejecting
    // events. Treat any change to this shape as a breaking API change.
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhookPayload(SAMPLE_PAYLOAD, SECRET, ts);
    const body = JSON.stringify(SAMPLE_PAYLOAD);

    expect(sig.startsWith(`t=${ts},v1=`)).toBe(true);
    expect(verifyAsD0rz(body, sig, SECRET)).toBe(true);
    expect(verifyAsSDK(body, sig, SECRET)).toBe(true);
  });
});
