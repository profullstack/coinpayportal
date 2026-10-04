import { describe, expect, it, vi } from 'vitest';
import { resolveIndeterminatePayout } from './service';

/**
 * Regression tests for N-03 (2026-08-19 audit).
 *
 * `indeterminate` had no exit transition. A payout lands there when the
 * broadcast outcome is unknown — a timeout after the node may already have
 * accepted the transaction — and `retryPayout` refuses to touch one, correctly,
 * because re-sending could pay the recipient twice. Its error message told the
 * operator to mark the payout completed with its tx_hash, or failed and retry,
 * and no route or function existed to do either. The state described a
 * procedure nobody could carry out, so those payouts were stuck forever.
 */

function supabaseWith(payout: Record<string, unknown> | null, updated: unknown = { id: 'p1' }) {
  const chain: any = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue({ data: payout, error: payout ? null : { message: 'not found' } }),
    maybeSingle: vi.fn().mockResolvedValue({ data: updated, error: null }),
  };
  return { from: vi.fn(() => chain), _chain: chain } as any;
}

const INDETERMINATE = { id: 'p1', business_id: 'b1', status: 'indeterminate', recipient_wallet: '0xabc' };

describe('resolveIndeterminatePayout', () => {
  it('marks a payout completed when given the transaction hash', async () => {
    const supabase = supabaseWith(INDETERMINATE);
    const result = await resolveIndeterminatePayout(supabase, 'b1', 'p1', 'completed', '0xdeadbeef');

    expect(result.success).toBe(true);
    expect(supabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', tx_hash: '0xdeadbeef' })
    );
  });

  it('refuses to mark completed without a transaction hash', async () => {
    // The hash is the evidence the transfer landed. Accepting the claim without
    // it would let an operator close a payout on nothing but assertion.
    const supabase = supabaseWith(INDETERMINATE);
    const result = await resolveIndeterminatePayout(supabase, 'b1', 'p1', 'completed');

    expect(result.success).toBe(false);
    expect(result.error).toContain('transaction hash is required');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('marks a payout failed so it becomes retryable again', async () => {
    const supabase = supabaseWith(INDETERMINATE);
    const result = await resolveIndeterminatePayout(supabase, 'b1', 'p1', 'failed');

    expect(result.success).toBe(true);
    expect(supabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('refuses to resolve a payout that is not indeterminate', async () => {
    // This transition exists only to break the deadlock. Pointing it at a
    // completed payout would be a way to rewrite settled money records.
    const supabase = supabaseWith({ ...INDETERMINATE, status: 'completed' });
    const result = await resolveIndeterminatePayout(supabase, 'b1', 'p1', 'failed');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Only an indeterminate payout');
  });

  it('refuses when the payout belongs to another business', async () => {
    const supabase = supabaseWith(null);
    const result = await resolveIndeterminatePayout(supabase, 'other-business', 'p1', 'failed');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Payout not found');
  });

  it('loses gracefully when another operator resolved it first', async () => {
    // The update is conditioned on the status still being indeterminate, so two
    // operators cannot both apply an outcome to the same payout.
    const supabase = supabaseWith(INDETERMINATE, null);
    const result = await resolveIndeterminatePayout(supabase, 'b1', 'p1', 'failed');

    expect(result.success).toBe(false);
    expect(result.error).toContain('resolved by someone else');
  });
});
