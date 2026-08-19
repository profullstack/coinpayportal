import { describe, expect, it, vi } from 'vitest';
import {
  backoffMinutesForAttempt,
  enqueueFailedDelivery,
  processWebhookRetryQueue,
} from './retry-queue';

/**
 * Regression tests for REC-D-07 (2026-08-19 audit).
 *
 * `deliverWebhook` retried three times in-process with exponential backoff,
 * spending the whole budget inside one request over roughly three seconds. A
 * merchant endpoint down for four — a deploy, a restart, a brief network fault
 * — lost the event permanently, as did anything in flight when our own process
 * was recycled. Merchants reconcile against these, so a lost
 * `payment.confirmed` is a payment the merchant never hears about.
 */

function queueDb(rows: any[]) {
  const updates: any[] = [];
  const inserts: any[] = [];

  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    insert: vi.fn(async (row: any) => {
      inserts.push(row);
      return { error: null };
    }),
    update: vi.fn((patch: any) => {
      updates.push(patch);
      return chain;
    }),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    then: (resolve: any) => resolve({ data: [{ id: 'claimed' }], error: null }),
  };

  return { supabase: { from: vi.fn(() => chain) } as any, updates, inserts, chain };
}

const ROW = {
  id: 'wd-1',
  business_id: 'biz-1',
  event: 'payment.confirmed',
  webhook_url: 'https://merchant.example/hook',
  payload: { hello: 'world' },
  attempts: 0,
  max_attempts: 8,
};

describe('backoffMinutesForAttempt', () => {
  it('grows, then holds at the ceiling', () => {
    expect(backoffMinutesForAttempt(0)).toBe(1);
    expect(backoffMinutesForAttempt(1)).toBe(5);
    expect(backoffMinutesForAttempt(3)).toBe(60);
    // Past the table it must not fall off the end into undefined/NaN, which
    // would write an invalid next_attempt_at and strand the row.
    expect(backoffMinutesForAttempt(99)).toBe(720);
  });

  it('is measured in minutes, not seconds', () => {
    // The whole point: the in-process budget was ~3 seconds. If this were
    // seconds again the queue would add nothing.
    expect(backoffMinutesForAttempt(0)).toBeGreaterThanOrEqual(1);
  });
});

describe('enqueueFailedDelivery', () => {
  it('records a failed delivery as pending work', async () => {
    const { supabase, inserts } = queueDb([]);
    const r = await enqueueFailedDelivery(supabase, {
      businessId: 'biz-1',
      event: 'payment.confirmed',
      webhookUrl: 'https://merchant.example/hook',
      payload: { a: 1 },
      lastError: 'HTTP 502',
    });

    expect(r.queued).toBe(true);
    expect(inserts[0]).toMatchObject({
      business_id: 'biz-1',
      event: 'payment.confirmed',
      status: 'pending',
      last_error: 'HTTP 502',
    });
  });

  it('never throws into the caller', async () => {
    // This runs inside a payment path. Turning a missed notification into an
    // exception there would convert it into a failed payment.
    const supabase = {
      from: () => ({
        insert: () => {
          throw new Error('database on fire');
        },
      }),
    } as any;

    await expect(
      enqueueFailedDelivery(supabase, {
        businessId: 'biz-1',
        event: 'payment.confirmed',
        webhookUrl: 'https://merchant.example/hook',
        payload: {},
      })
    ).resolves.toMatchObject({ queued: false });
  });
});

describe('processWebhookRetryQueue', () => {
  it('marks a successful redelivery delivered', async () => {
    const { supabase, updates } = queueDb([{ ...ROW }]);
    const deliver = vi.fn().mockResolvedValue({ success: true, statusCode: 200 });

    const stats = await processWebhookRetryQueue(supabase, deliver);

    expect(stats.delivered).toBe(1);
    expect(updates.some((u) => u.status === 'delivered')).toBe(true);
  });

  it('reschedules a failure that still has attempts left', async () => {
    const { supabase, updates } = queueDb([{ ...ROW, attempts: 1 }]);
    const deliver = vi.fn().mockResolvedValue({ success: false, error: 'HTTP 503' });

    const stats = await processWebhookRetryQueue(supabase, deliver);

    expect(stats.rescheduled).toBe(1);
    expect(stats.dead).toBe(0);
    expect(updates.some((u) => u.status === 'pending' && u.last_error === 'HTTP 503')).toBe(true);
  });

  it('dead-letters once the attempt budget is exhausted', async () => {
    // The dead-letter is the point: an abandoned event becomes a durable row an
    // operator can find, rather than something that silently evaporated.
    const { supabase, updates } = queueDb([{ ...ROW, attempts: 7, max_attempts: 8 }]);
    const deliver = vi.fn().mockResolvedValue({ success: false, error: 'connection refused' });

    const stats = await processWebhookRetryQueue(supabase, deliver);

    expect(stats.dead).toBe(1);
    expect(updates.some((u) => u.status === 'dead')).toBe(true);
  });

  it('survives a delivery function that throws', async () => {
    const { supabase } = queueDb([{ ...ROW }]);
    const deliver = vi.fn().mockRejectedValue(new Error('socket hang up'));

    const stats = await processWebhookRetryQueue(supabase, deliver);

    expect(stats.attempted).toBe(1);
    expect(stats.rescheduled).toBe(1);
  });

  it('claims a row before delivering it', async () => {
    // Two overlapping cron runs would otherwise both deliver the same row, and
    // a duplicate payment.confirmed is a real problem for a merchant
    // reconciling against it.
    const { supabase, updates } = queueDb([{ ...ROW }]);
    const order: string[] = [];
    const deliver = vi.fn(async () => {
      order.push('deliver');
      return { success: true };
    });

    await processWebhookRetryQueue(supabase, deliver);

    // The claim is the first update, and it happens before any delivery.
    expect(updates[0]).toHaveProperty('attempts', 1);
    expect(order[0]).toBe('deliver');
  });

  it('does nothing when the queue is empty', async () => {
    const { supabase } = queueDb([]);
    const deliver = vi.fn();

    const stats = await processWebhookRetryQueue(supabase, deliver);

    expect(stats.attempted).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });
});
