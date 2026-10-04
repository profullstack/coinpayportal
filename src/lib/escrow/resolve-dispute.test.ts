import { describe, expect, it, vi } from 'vitest';
import { resolveDispute, refundEscrow } from './service';

vi.mock('../webhooks/service', () => ({ sendEscrowWebhook: vi.fn() }));

/**
 * Regression tests for ESC-NEW-01 (2026-08-19 audit).
 *
 * `dispute_resolution` and `dispute_status` exist in the production schema and
 * had no writer anywhere. `disputeEscrow` set `status = 'disputed'` and
 * `dispute_reason` and stopped, so a dispute recorded a grievance and changed
 * nothing else.
 *
 * The consequence was worse than a missing audit field: a disputed escrow could
 * only be *released*, and only by the depositor. Refund required `funded`, so
 * raising a dispute removed the refund path — whoever raised one made their own
 * position strictly worse, and the escrow sat until someone gave up.
 */

function supabaseWith(escrow: Record<string, unknown> | null, updated: unknown = { id: 'esc-1' }) {
  const chain: any = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => Promise.resolve({ error: null })),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(
      escrow ? { data: escrow, error: null } : { data: null, error: { message: 'not found' } }
    ),
  };
  // The update chain ends in .select().single(); make that answer `updated`.
  let seenUpdate = false;
  chain.update = vi.fn(() => {
    seenUpdate = true;
    return chain;
  });
  chain.single = vi.fn().mockImplementation(() =>
    Promise.resolve(
      seenUpdate
        ? { data: updated, error: null }
        : escrow
          ? { data: escrow, error: null }
          : { data: null, error: { message: 'not found' } }
    )
  );
  return { from: vi.fn(() => chain), _chain: chain } as any;
}

const DISPUTED = {
  id: 'esc-1',
  status: 'disputed',
  business_id: 'biz-1',
  depositor_address: '0xdep',
  beneficiary_address: '0xben',
  release_token: 'esc_tok',
  beneficiary_token: 'esc_ben',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
};

describe('resolveDispute', () => {
  it('settles a disputed escrow to the beneficiary', async () => {
    const db = supabaseWith(DISPUTED);
    const r = await resolveDispute(db, 'esc-1', {
      resolution: 'release',
      note: 'Work delivered and verified against the brief.',
      resolvedBy: 'admin@example.com',
    });

    expect(r.success).toBe(true);
    expect(db._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'released', dispute_status: 'resolved' })
    );
  });

  it('returns a disputed escrow to the depositor', async () => {
    const db = supabaseWith(DISPUTED);
    const r = await resolveDispute(db, 'esc-1', {
      resolution: 'refund',
      note: 'Nothing was delivered within the agreed window.',
      resolvedBy: 'admin@example.com',
    });

    expect(r.success).toBe(true);
    expect(db._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refunded', dispute_status: 'resolved' })
    );
  });

  it('writes the resolution note — the column that never had a writer', async () => {
    const db = supabaseWith(DISPUTED);
    await resolveDispute(db, 'esc-1', {
      resolution: 'refund',
      note: 'Beneficiary conceded in writing.',
      resolvedBy: 'admin@example.com',
    });

    expect(db._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ dispute_resolution: 'Beneficiary conceded in writing.' })
    );
  });

  it('requires a substantive note', async () => {
    // The note is the record of why someone else's money moved. An empty one
    // makes the arbitration unauditable.
    const db = supabaseWith(DISPUTED);
    const r = await resolveDispute(db, 'esc-1', {
      resolution: 'refund',
      note: 'nope',
      resolvedBy: 'admin@example.com',
    });

    expect(r.success).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('refuses an escrow that is not disputed', async () => {
    // This exit exists only to break the deadlock. Pointing it at a funded
    // escrow would be a way to move money with no counterparty involvement.
    const db = supabaseWith({ ...DISPUTED, status: 'funded' });
    const r = await resolveDispute(db, 'esc-1', {
      resolution: 'release',
      note: 'Trying to short-circuit the normal flow.',
      resolvedBy: 'admin@example.com',
    });

    expect(r.success).toBe(false);
    expect(r.error).toContain('Only a disputed escrow');
  });

  it('rejects an unknown resolution', async () => {
    const db = supabaseWith(DISPUTED);
    const r = await resolveDispute(db, 'esc-1', {
      resolution: 'keep' as unknown as 'refund',
      note: 'Neither party gets it, apparently.',
      resolvedBy: 'admin@example.com',
    });

    expect(r.success).toBe(false);
  });
});

describe('refundEscrow from disputed (ESC-NEW-01)', () => {
  it('lets the beneficiary concede after a dispute is raised', async () => {
    // Refund required `funded`, so raising a dispute removed the cooperative
    // exit: a beneficiary who wanted to hand the money back could not.
    const db = supabaseWith(DISPUTED);
    const r = await refundEscrow(db, 'esc-1', 'esc_ben');

    expect(r.success).toBe(true);
  });
});
