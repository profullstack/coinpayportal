import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { proposalChallenge, disputeChallenge, verifyActionProof } from './proof';

/**
 * Regression tests for F-1.1-02 (2026-08-19 audit).
 *
 * `resolveSignerRole` decided which party you are by comparing the pubkey you
 * sent against the three stored on the escrow. A public key is public — and
 * until this branch the escrow GET was unauthenticated too (F-1.1-03), so
 * anyone could read all three and then act as any party by echoing one back.
 */

const priv = secp256k1.utils.randomSecretKey();
const pub = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');

const otherPriv = secp256k1.utils.randomSecretKey();
const otherPub = Buffer.from(secp256k1.getPublicKey(otherPriv, true)).toString('hex');

function sign(challenge: string, key: Uint8Array = priv): string {
  return Buffer.from(secp256k1.sign(new TextEncoder().encode(challenge), key)).toString('hex');
}

const PROPOSAL = { escrowId: 'esc-1', proposalType: 'release', toAddress: '0xAbC' };

describe('verifyActionProof', () => {
  it('accepts a signature from the key behind the pubkey', () => {
    const c = proposalChallenge(PROPOSAL);
    expect(verifyActionProof(c, sign(c), pub)).toBe(true);
  });

  it('rejects a pubkey presented without any signature', () => {
    // The finding itself: knowing a participant's public key was enough.
    const c = proposalChallenge(PROPOSAL);
    expect(verifyActionProof(c, undefined, pub)).toBe(false);
    expect(verifyActionProof(c, '', pub)).toBe(false);
  });

  it('rejects a signature made by a different key', () => {
    const c = proposalChallenge(PROPOSAL);
    expect(verifyActionProof(c, sign(c, otherPriv), pub)).toBe(false);
  });

  it('rejects a signature over a different action', () => {
    // Binding the challenge to the action is what stops a captured signature
    // authorising a payout to somewhere else.
    const signed = proposalChallenge(PROPOSAL);
    const attempted = proposalChallenge({ ...PROPOSAL, toAddress: '0xAttacker' });
    expect(verifyActionProof(attempted, sign(signed), pub)).toBe(false);
  });

  it('rejects a release signature replayed as a refund', () => {
    const signed = proposalChallenge({ ...PROPOSAL, proposalType: 'release' });
    const attempted = proposalChallenge({ ...PROPOSAL, proposalType: 'refund' });
    expect(verifyActionProof(attempted, sign(signed), pub)).toBe(false);
  });

  it('rejects a signature for one escrow replayed against another', () => {
    const signed = proposalChallenge(PROPOSAL);
    const attempted = proposalChallenge({ ...PROPOSAL, escrowId: 'esc-2' });
    expect(verifyActionProof(attempted, sign(signed), pub)).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    const c = proposalChallenge(PROPOSAL);
    expect(verifyActionProof(c, 'not-hex', pub)).toBe(false);
    expect(verifyActionProof(c, sign(c), 'not-hex')).toBe(false);
    expect(verifyActionProof(c, sign(c), undefined)).toBe(false);
  });

  it('binds a dispute to its stated reason', () => {
    const signed = disputeChallenge({ escrowId: 'esc-1', reason: 'not delivered' });
    const attempted = disputeChallenge({ escrowId: 'esc-1', reason: 'something else' });
    expect(verifyActionProof(signed, sign(signed), pub)).toBe(true);
    expect(verifyActionProof(attempted, sign(signed), pub)).toBe(false);
  });

  it('treats the recipient case-insensitively, as addresses are', () => {
    const lower = proposalChallenge({ ...PROPOSAL, toAddress: '0xabc' });
    const upper = proposalChallenge({ ...PROPOSAL, toAddress: '0xABC' });
    expect(lower).toBe(upper);
  });

  it('a different key is genuinely different', () => {
    // Guards the fixtures themselves: if these collided the tests above would
    // pass for the wrong reason.
    expect(pub).not.toBe(otherPub);
  });
});
