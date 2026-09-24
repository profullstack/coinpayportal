import { describe, it, expect } from 'vitest';
import { settleForwardingMetadata } from './reconciliation';

describe('settleForwardingMetadata', () => {
  /*
   * The row from the 2026-09-24 incident, exactly as it was stamped when the
   * forward failed on an empty gas relayer.
   */
  const afterFailedAttempt = {
    email: 'buyer@example.com',
    product: 'credit',
    credit_micros: '5000000',
    reconciliation_required: true,
    forwarding_error: 'Gas relayer 0xA3c9…Eb6B has 0.0 but needs ~0.00294887868026 for USDC_ETH. Top up the relayer.',
    forwarding_failed_at: '2026-09-24T18:02:32.445Z',
    forwarding_started_at: '2026-09-24T18:02:31.620Z',
  };

  it('retracts the three marks a failed attempt leaves', () => {
    const { changed, metadata } = settleForwardingMetadata(afterFailedAttempt);
    expect(changed).toBe(true);
    expect(metadata).not.toHaveProperty('reconciliation_required');
    expect(metadata).not.toHaveProperty('forwarding_error');
    expect(metadata).not.toHaveProperty('forwarding_failed_at');
  });

  it('keeps every other key, because the sale is described in there', () => {
    const { metadata } = settleForwardingMetadata(afterFailedAttempt);
    expect(metadata.email).toBe('buyer@example.com');
    expect(metadata.credit_micros).toBe('5000000');
    expect(metadata.forwarding_started_at).toBe('2026-09-24T18:02:31.620Z');
  });

  it('keeps the error as history and records when it stopped being a question', () => {
    const { metadata } = settleForwardingMetadata(afterFailedAttempt, '2026-09-24T18:36:49.143Z');
    expect(metadata.resolved_forwarding_error).toContain('Top up the relayer');
    expect(metadata.reconciliation_resolved_at).toBe('2026-09-24T18:36:49.143Z');
  });

  it('reports no change for a forward that never failed, so metadata is not rewritten', () => {
    const clean = { email: 'buyer@example.com', product: 'credit' };
    const { changed, metadata } = settleForwardingMetadata(clean);
    expect(changed).toBe(false);
    expect(metadata).toEqual(clean);
  });

  it('notices a failure marked by any one of the three keys alone', () => {
    expect(settleForwardingMetadata({ reconciliation_required: true }).changed).toBe(true);
    expect(settleForwardingMetadata({ forwarding_error: 'boom' }).changed).toBe(true);
    expect(settleForwardingMetadata({ forwarding_failed_at: 'then' }).changed).toBe(true);
  });

  it('clears a flag even when it was written false, rather than leaving the key behind', () => {
    const { changed, metadata } = settleForwardingMetadata({ reconciliation_required: false });
    expect(changed).toBe(true);
    expect(metadata).not.toHaveProperty('reconciliation_required');
  });

  it('does not mutate the caller\'s object', () => {
    const original = { ...afterFailedAttempt };
    settleForwardingMetadata(original);
    expect(original.reconciliation_required).toBe(true);
    expect(original.forwarding_error).toBeDefined();
  });

  it('survives a row whose metadata is null, a string, or an array', () => {
    for (const bad of [null, undefined, 'not metadata', ['also', 'not'], 42]) {
      const { changed, metadata } = settleForwardingMetadata(bad);
      expect(changed).toBe(false);
      expect(metadata).toEqual({});
    }
  });

  it('omits resolved_forwarding_error when the failure recorded no message', () => {
    const { metadata } = settleForwardingMetadata({ reconciliation_required: true });
    expect(metadata).not.toHaveProperty('resolved_forwarding_error');
    expect(metadata.reconciliation_resolved_at).toBeDefined();
  });
});
