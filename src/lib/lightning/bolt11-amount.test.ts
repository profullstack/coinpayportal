import { describe, expect, it } from 'vitest';
import { bolt11AmountMsat } from './bolt11-amount';

/**
 * Regression tests for W-05 (High, 2026-08-19 audit).
 *
 * Paying a Lightning Address asks the recipient's LNURL server for an invoice
 * and then paid whatever came back, undecoded — so the amount actually paid was
 * whatever that server chose, not the amount the sender entered and was shown.
 *
 * The amounts below are the canonical examples from the BOLT-11 specification.
 */
describe('bolt11AmountMsat', () => {
  it('reads a milli-BTC amount', () => {
    // lnbc2500u… = 2500 micro-BTC = 0.0025 BTC = 250,000,000 msat
    expect(bolt11AmountMsat('lnbc2500u1pvjluezpp5abcdef')).toBe(250_000_000);
  });

  it('reads a nano-BTC amount', () => {
    // 20 nano-BTC = 2000 msat
    expect(bolt11AmountMsat('lnbc20n1pvjluezpp5abcdef')).toBe(2_000);
  });

  it('reads a pico-BTC amount', () => {
    // 9,678,785,340 pico-BTC = 967,878,534 msat
    expect(bolt11AmountMsat('lnbc9678785340p1pwmna7lpp5abcdef')).toBe(967_878_534);
  });

  it('reads a milli multiplier', () => {
    // 1 milli-BTC = 100,000,000 msat
    expect(bolt11AmountMsat('lnbc1m1pvjluezpp5abcdef')).toBe(100_000_000);
  });

  it('treats an amountless invoice as unverifiable, not as zero', () => {
    // A donation invoice lets the PAYER choose, so paying it blindly is exactly
    // the hole this closes. `null` must not be mistaken for 0.
    expect(bolt11AmountMsat('lnbc1pvjluezpp5abcdef')).toBeNull();
  });

  it('is case-insensitive, as invoices may be uppercased for QR encoding', () => {
    expect(bolt11AmountMsat('LNBC2500U1PVJLUEZPP5ABCDEF')).toBe(250_000_000);
  });

  it('refuses anything that is not a mainnet invoice', () => {
    expect(bolt11AmountMsat('lntb2500u1pvjluezpp5abcdef')).toBeNull();
    expect(bolt11AmountMsat('not-an-invoice')).toBeNull();
    expect(bolt11AmountMsat('')).toBeNull();
  });

  it('refuses a malformed amount rather than guessing', () => {
    expect(bolt11AmountMsat('lnbc25x1pvjluezpp5abcdef')).toBeNull();
    expect(bolt11AmountMsat('lnbc2.5u1pvjluezpp5abcdef')).toBeNull();
  });

  it('refuses a pico amount that is not a whole millisatoshi', () => {
    // BOLT-11 requires pico amounts to be a multiple of 10.
    expect(bolt11AmountMsat('lnbc1p1pvjluezpp5abcdef')).toBeNull();
  });

  it('distinguishes the amount a hostile server would substitute', () => {
    // The concrete attack: sender asked for 1,000 sats (1,000,000 msat), the
    // server returns an invoice for 1 BTC.
    const asked = 1_000_000;
    const returned = bolt11AmountMsat('lnbc11pvjluezpp5abcdef');

    expect(returned).toBe(100_000_000_000);
    expect(returned).not.toBe(asked);
  });
});
