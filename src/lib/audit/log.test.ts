import { describe, expect, it, vi, beforeEach } from 'vitest';
import { recordAuditEvent, redactAuditDetail } from './log';

/**
 * Tests for AUD-01 (2026-08-19 audit).
 *
 * No audit-logging infrastructure existed anywhere, while
 * `docs/SECURITY_KEYS.md` carried `[x] Audit logging for key operations` and
 * `docs/SECURITY.md` described a four-point audit trail in the present tense.
 * The documents were corrected earlier in this branch; this is the thing they
 * described.
 */

function makeSupabase(error: { message: string } | null = null) {
  const inserted: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error };
      },
    }),
  };
  return { client: client as never, inserted };
}

describe('redactAuditDetail', () => {
  it('strips key material by field name', () => {
    const out = redactAuditDetail({
      refundPrivateKey: 'abc',
      api_key: 'cp_live_x',
      password: 'hunter2',
      mnemonic: 'word word word',
      amount: 100,
    });

    expect(out.refundPrivateKey).toBe('[redacted]');
    expect(out.api_key).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.mnemonic).toBe('[redacted]');
    // Everything else survives, or the log is useless.
    expect(out.amount).toBe(100);
  });

  it('strips nested secrets too', () => {
    const out = redactAuditDetail({
      swap: { provider: 'boltz', claimPrivateKey: 'abc' },
    });

    expect((out.swap as Record<string, unknown>).provider).toBe('boltz');
    expect((out.swap as Record<string, unknown>).claimPrivateKey).toBe('[redacted]');
  });

  it('does not recurse without bound', () => {
    // A cyclic-ish or very deep object must not hang the writer.
    let deep: Record<string, unknown> = { secret: 'x' };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(() => redactAuditDetail(deep)).not.toThrow();
  });
});

describe('recordAuditEvent', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('writes who, what and to what', () => {
    const { client, inserted } = makeSupabase();

    return recordAuditEvent(client, {
      action: 'wallet.payout_changed',
      actorType: 'platform',
      actorId: 'ugig',
      subjectType: 'merchant_wallet',
      subjectId: 'merchant-1',
      merchantId: 'merchant-1',
      detail: { cryptocurrency: 'BTC' },
    }).then(() => {
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        action: 'wallet.payout_changed',
        actor_type: 'platform',
        actor_id: 'ugig',
        subject_type: 'merchant_wallet',
        subject_id: 'merchant-1',
      });
    });
  });

  it('redacts key material on the way in', async () => {
    const { client, inserted } = makeSupabase();

    await recordAuditEvent(client, {
      action: 'key.released',
      actorType: 'merchant',
      subjectType: 'swap',
      detail: { refundPrivateKey: 'must-not-persist' },
    });

    expect(JSON.stringify(inserted[0])).not.toContain('must-not-persist');
  });

  it('never throws when the write fails', async () => {
    // An audit write that can fail a payment turns an observability feature
    // into an availability risk, and the first incident would get it removed.
    const { client } = makeSupabase({ message: 'relation does not exist' });

    await expect(
      recordAuditEvent(client, {
        action: 'payment.confirmed',
        actorType: 'system',
        subjectType: 'payment',
      })
    ).resolves.toBeUndefined();
  });

  it('says so loudly when it cannot record', async () => {
    // webhook_logs sat empty for its entire existence because nothing
    // complained. This one complains.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeSupabase({ message: 'permission denied' });

    await recordAuditEvent(client, {
      action: 'payment.confirmed',
      actorType: 'system',
      subjectType: 'payment',
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('payment.confirmed'),
      expect.anything()
    );
  });

  it('survives a client that throws outright', async () => {
    const exploding = { from: () => { throw new Error('boom'); } } as never;

    await expect(
      recordAuditEvent(exploding, {
        action: 'payment.confirmed',
        actorType: 'system',
        subjectType: 'payment',
      })
    ).resolves.toBeUndefined();
  });
});
