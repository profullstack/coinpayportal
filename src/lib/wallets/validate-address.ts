import { isValidPayoutAddress } from '../blockchain/address-format';

/**
 * Validate a merchant-supplied payout address.
 *
 * H-R-09: `walletAddressSchema` was `z.string().min(26).max(100)` — length and
 * nothing else — and it was declared separately in `wallets/service.ts` and
 * `wallets/merchant-service.ts`, so the two tables could drift apart as well as
 * both being wrong. These rows are payout destinations: whatever a merchant
 * saves here is where their money is sent. A transposed character, an address
 * pasted for the wrong chain, or a line of prose 30 characters long all passed.
 *
 * Now shared, so the two wallet tables cannot disagree about what a valid
 * address is, and format-checked against the chain it is being saved for.
 *
 * `isValidPayoutAddress` is deliberately three-state and that is preserved
 * here: `false` means "malformed for this chain" and is rejected, while `null`
 * means "no validator exists for this chain" and is allowed through. Blocking a
 * chain we have no rule for would break saving a perfectly good address, which
 * is a worse outcome than the check being unavailable — and it is the same
 * contract /api/payments/create already uses for the same decision.
 */
export function validateWalletAddress(
  address: unknown,
  cryptocurrency: string
): { ok: true; address: string } | { ok: false; error: string } {
  if (typeof address !== 'string') {
    return { ok: false, error: 'Invalid wallet address' };
  }

  const trimmed = address.trim();

  // Kept as a cheap first pass. No supported chain has an address shorter than
  // 26 characters or longer than 100, so this rejects obvious rubbish before
  // any per-chain work.
  if (trimmed.length < 26 || trimmed.length > 100) {
    return { ok: false, error: 'Invalid wallet address' };
  }

  if (isValidPayoutAddress(trimmed, cryptocurrency) === false) {
    return { ok: false, error: `Invalid ${cryptocurrency} wallet address` };
  }

  return { ok: true, address: trimmed };
}
