import { describe, expect, it } from 'vitest';
import { validateWalletAddress } from './validate-address';

/**
 * Regression tests for H-R-09 (2026-08-19 audit).
 *
 * `walletAddressSchema` was `z.string().min(26).max(100)` — length and nothing
 * else — and was declared separately in `wallets/service.ts` and
 * `wallets/merchant-service.ts`, so the two payout tables could drift apart as
 * well as both being wrong.
 *
 * These rows are payout destinations: whatever a merchant saves is where their
 * money is sent. There is no confirmation step downstream and no way to recall
 * a transfer, so this validator is the only thing between a typo and a
 * permanent loss.
 */
describe('validateWalletAddress', () => {
  it('accepts a well-formed address for its chain', () => {
    const r = validateWalletAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1', 'ETH');
    expect(r.ok).toBe(true);
  });

  it('rejects an EVM address of the wrong length', () => {
    // Found in this repository's own test fixtures, where it had passed the
    // length-only check for as long as it had existed: 44 hex characters where
    // an Ethereum address has 40. Long enough to look right at a glance.
    const r = validateWalletAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1234', 'ETH');
    expect(r.ok).toBe(false);
  });

  it('rejects an address that belongs to a different chain', () => {
    // The realistic mistake: a merchant pastes their Bitcoin address into the
    // Ethereum row. Both are "a wallet address" and both pass on length.
    const r = validateWalletAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'ETH');
    expect(r.ok).toBe(false);
  });

  it('rejects prose of a plausible length', () => {
    const r = validateWalletAddress('please send my money here thanks', 'ETH');
    expect(r.ok).toBe(false);
  });

  it('rejects anything too short or too long to be an address', () => {
    expect(validateWalletAddress('0xabc', 'ETH').ok).toBe(false);
    expect(validateWalletAddress('0x' + 'a'.repeat(200), 'ETH').ok).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(validateWalletAddress(undefined, 'ETH').ok).toBe(false);
    expect(validateWalletAddress(12345, 'ETH').ok).toBe(false);
  });

  it('trims surrounding whitespace rather than rejecting it', () => {
    // Pasting an address commonly brings a trailing space or newline with it,
    // and failing on that would be an annoyance rather than a protection.
    const r = validateWalletAddress('  0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1  ', 'ETH');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1');
  });

  it('allows a chain it has no validator for, rather than blocking the save', () => {
    // `isValidPayoutAddress` is three-state on purpose: `null` means "no rule
    // for this chain". Refusing then would break saving a perfectly good
    // address, which is worse than the check being unavailable — and it is the
    // same contract /api/payments/create uses for the same decision.
    const r = validateWalletAddress('some-address-for-an-unknown-chain-value', 'NOT_A_CHAIN');
    expect(r.ok).toBe(true);
  });
});
