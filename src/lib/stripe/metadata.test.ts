import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sanitizeStripeMetadata, isReservedStripeMetadataKey } from './metadata';

/**
 * Regression tests for CP-001 (High, 2026-08-19 audit).
 *
 * Stripe sessions are created with `{ ...callerMetadata, business_id, ... }`.
 * The spread order protects the fields listed explicitly — and only those.
 * `coinpay_payment_id` is not one of them, and the Stripe webhook uses exactly
 * that key to decide which payment row to mark confirmed.
 *
 * So a caller could attach `coinpay_payment_id` pointing at another merchant's
 * pending payment, complete their own one-cent checkout, and have the webhook
 * confirm the victim's payment as paid.
 */
describe('sanitizeStripeMetadata', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('drops the key the webhook routes on', () => {
    const out = sanitizeStripeMetadata({
      order_ref: 'ABC-1',
      coinpay_payment_id: 'someone-elses-payment',
    });

    expect(out).toEqual({ order_ref: 'ABC-1' });
  });

  it('drops every coinpay_-prefixed key, not just the known ones', () => {
    // Reserved wholesale by prefix, so a new internal field cannot be forgotten.
    const out = sanitizeStripeMetadata({
      coinpay_payment_id: 'x',
      coinpay_invoice_id: 'y',
      coinpay_some_future_field: 'z',
      keep: 'me',
    });

    expect(out).toEqual({ keep: 'me' });
  });

  it('drops tenant and fee fields', () => {
    const out = sanitizeStripeMetadata({
      business_id: 'victim',
      merchant_id: 'victim',
      platform_fee_amount: '0',
      platform_fee_percent: '0',
      invoice_number: 'INV-9',
      idempotency_key: 'invoice:someone-else:initial',
      note: 'fine',
    });

    expect(out).toEqual({ note: 'fine' });
  });

  it('keeps ordinary integrator metadata untouched', () => {
    const meta = { order_id: '42', customer_ref: 'abc', nested: 'value' };
    expect(sanitizeStripeMetadata(meta)).toEqual(meta);
  });

  it('logs what it dropped, since that is a bug or an attempt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sanitizeStripeMetadata({ coinpay_payment_id: 'x' }, 'test-context');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('coinpay_payment_id'));
  });

  it('handles absent or malformed metadata', () => {
    expect(sanitizeStripeMetadata(undefined)).toEqual({});
    expect(sanitizeStripeMetadata(null)).toEqual({});
    expect(sanitizeStripeMetadata('not an object')).toEqual({});
    expect(sanitizeStripeMetadata(['a'])).toEqual({});
  });
});

describe('isReservedStripeMetadataKey', () => {
  it('recognises reserved keys', () => {
    expect(isReservedStripeMetadataKey('coinpay_payment_id')).toBe(true);
    expect(isReservedStripeMetadataKey('business_id')).toBe(true);
    expect(isReservedStripeMetadataKey('platform_fee_amount')).toBe(true);
    expect(isReservedStripeMetadataKey('idempotency_key')).toBe(true);
  });

  it('leaves integrator keys alone', () => {
    expect(isReservedStripeMetadataKey('order_id')).toBe(false);
    expect(isReservedStripeMetadataKey('my_coinpay_note')).toBe(false);
  });
});
