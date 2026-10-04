import { secp256k1 } from '@noble/curves/secp256k1.js';

/**
 * Proof of possession for multisig escrow actions.
 *
 * F-1.1-02: `resolveSignerRole` decided which party you are by comparing the
 * pubkey you sent against the three stored on the escrow. A public key is
 * public — that is the entire point of it — and until this branch the escrow
 * GET was unauthenticated too (F-1.1-03), so anyone could read all three
 * pubkeys and then act as any party by echoing one back. No signature was
 * required anywhere in propose or dispute.
 *
 * The fix is to require a signature over a challenge that *binds the specific
 * action*, and to verify it against the claimed key before the role is
 * resolved. Binding the action matters: a signature over a bare nonce could be
 * captured and replayed against a different proposal, whereas one over
 * "release escrow X to address Y" authorises only that.
 *
 * Multisig escrows use secp256k1 keys on every supported chain, so one verifier
 * covers them.
 */

/**
 * Canonical challenge for a proposal.
 *
 * Field order and separator are fixed because both sides must derive the same
 * bytes; changing either silently invalidates every existing client.
 */
export function proposalChallenge(params: {
  escrowId: string;
  proposalType: string;
  toAddress: string;
}): string {
  return [
    'coinpay-multisig-propose',
    params.escrowId,
    params.proposalType,
    params.toAddress.toLowerCase(),
  ].join('|');
}

/** Canonical challenge for raising a dispute. */
export function disputeChallenge(params: { escrowId: string; reason: string }): string {
  return ['coinpay-multisig-dispute', params.escrowId, params.reason].join('|');
}

/**
 * Verify a compact secp256k1 signature over `challenge` for `pubkeyHex`.
 *
 * Returns false on any malformed input rather than throwing: a caller deciding
 * whether someone is authorised must get a boolean, not an exception that a
 * surrounding try/catch might convert into a pass.
 */
export function verifyActionProof(
  challenge: string,
  signatureHex: string | undefined | null,
  pubkeyHex: string | undefined | null,
): boolean {
  if (!signatureHex || !pubkeyHex) return false;

  try {
    const clean = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);
    // Verified over the raw challenge bytes, matching how wallet auth signs and
    // verifies elsewhere in this codebase (see web-wallet/auth.ts). The two must
    // agree on whether the message is pre-hashed, so following the existing
    // convention is what keeps a client able to sign for both.
    const messageBytes = new TextEncoder().encode(challenge);
    const sigBytes = Uint8Array.from(Buffer.from(clean(signatureHex), 'hex'));
    const pubKeyBytes = Uint8Array.from(Buffer.from(clean(pubkeyHex), 'hex'));

    if (sigBytes.length === 0 || pubKeyBytes.length === 0) return false;

    return secp256k1.verify(sigBytes, messageBytes, pubKeyBytes);
  } catch {
    return false;
  }
}
