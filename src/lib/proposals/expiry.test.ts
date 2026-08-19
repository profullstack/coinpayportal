import { describe, expect, it, vi } from 'vitest';
import { assertNotExpired } from './service';
import type { Proposal } from './types';

/**
 * Regression tests for NEW-F1A-P-02 (2026-08-19 audit).
 *
 * `expires_at` was checked in exactly one place — `acceptProposal` — so an
 * expired proposal could still be countered, rejected, withdrawn, re-sent and
 * viewed by token. The deadline meant "you cannot accept this" rather than
 * "this is over", which is not what either party takes it to mean.
 *
 * `'expired'` is also a permitted value of `proposals_status_check` that
 * nothing ever wrote, so no proposal has ever appeared as expired anywhere —
 * they sit as `sent` for ever.
 */

function supabase() {
  const chain: any = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return { from: vi.fn(() => chain), _chain: chain } as any;
}

const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();

function proposal(over: Partial<Proposal> = {}): Proposal {
  return { id: 'p1', status: 'sent', expires_at: FUTURE, ...over } as Proposal;
}

describe('assertNotExpired', () => {
  it('allows a proposal inside its deadline', async () => {
    const db = supabase();
    expect(await assertNotExpired(db, proposal())).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('allows a proposal with no deadline at all', async () => {
    const db = supabase();
    expect(await assertNotExpired(db, proposal({ expires_at: null }))).toBeNull();
  });

  it('refuses a proposal past its deadline', async () => {
    const result = await assertNotExpired(supabase(), proposal({ expires_at: PAST }));
    expect(result?.ok).toBe(false);
    expect(result?.code).toBe('EXPIRED');
    expect(result?.status).toBe(409);
  });

  it("gives the 'expired' status a producer", async () => {
    // The state was reachable in the schema and in the type union, and
    // unreachable in practice — nothing ever wrote it.
    const db = supabase();
    await assertNotExpired(db, proposal({ expires_at: PAST }));

    expect(db.from).toHaveBeenCalledWith('proposals');
    expect(db._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired' })
    );
    // Conditioned on the proposal still being negotiable, so a concurrent
    // accept or reject is not overwritten by a lazy expiry.
    expect(db._chain.in).toHaveBeenCalledWith('status', ['sent', 'countered']);
  });

  it('does not rewrite the status of an already-closed proposal', async () => {
    // An accepted proposal that happens to be past its deadline is still
    // accepted; expiry must not undo a decision.
    const db = supabase();
    const result = await assertNotExpired(db, proposal({ status: 'accepted', expires_at: PAST }));

    expect(result?.ok).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('treats an unparseable deadline as no deadline', async () => {
    // Refusing to act because of a bad timestamp would be a worse failure than
    // letting it through — the deal is real, the date field is not.
    const db = supabase();
    expect(await assertNotExpired(db, proposal({ expires_at: 'not-a-date' }))).toBeNull();
  });
});
