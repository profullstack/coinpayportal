// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import { activateSubscriptionFromCheckoutSession } from './activate';
import { markCheckoutSessionPaidFromWebhook } from '@/lib/checkout/settle';
import { DEFAULT_BILLING_BUSINESS_ID } from './plans';

const MERCHANT = '11111111-2222-3333-4444-555555555555';
const SESSION = 'cs_abcdefghijklmnopqrstuvwx';

type Row = Record<string, any>;

/** A tiny in-memory PostgREST stand-in: eq / neq / is(json->>key, null) filters. */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: { table: string; op: string; values?: Row }[] = [];
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Row | undefined;
    const rows = () => (tables[table] ||= []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op === 'update') {
        const hit = rows();
        hit.forEach((r) => Object.assign(r, values));
        calls.push({ table, op, values });
        return hit;
      }
      return rows();
    };
    const b: any = {
      select: () => b,
      update: (v: Row) => ((op = 'update'), (values = v), b),
      insert: async (v: Row) => {
        (tables[table] ||= []).push(v);
        calls.push({ table, op: 'insert', values: v });
        return { error: null };
      },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      is: (k: string, v: unknown) => {
        const m = k.match(/^(\w+)->>(\w+)$/);
        filters.push((r) => (m ? (r[m[1]]?.[m[2]] ?? null) : r[k]) === v);
        return b;
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
    };
    return b;
  }
  return { db: { from: builder } as any, calls, tables };
}

function session(overrides: Row = {}): Row {
  return {
    id: SESSION,
    business_id: DEFAULT_BILLING_BUSINESS_ID,
    status: 'paid',
    amount: 49,
    currency: 'USD',
    account_id: MERCHANT,
    paid_method: 'USDC_POL',
    paid_reference: 'pay-1',
    metadata: { type: 'subscription_payment', plan_id: 'professional', billing_period: 'monthly', merchant_id: MERCHANT },
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.COINPAY_BILLING_BUSINESS_ID;
});

describe('activateSubscriptionFromCheckoutSession', () => {
  it('grants Professional for a month and is idempotent', async () => {
    const { db, tables } = fakeDb({
      checkout_sessions: [session()],
      merchants: [{ id: MERCHANT, subscription_plan_id: 'starter', subscription_status: 'active', subscription_ends_at: null }],
    });
    const first = await activateSubscriptionFromCheckoutSession(db, SESSION);
    expect(first).toEqual({ activated: true });
    const m = tables.merchants[0];
    expect(m.subscription_plan_id).toBe('professional');
    expect(m.subscription_status).toBe('active');
    const days = (Date.parse(m.subscription_ends_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect(tables.subscription_history).toHaveLength(1);
    expect(tables.subscription_history[0].change_type).toBe('upgrade');

    const second = await activateSubscriptionFromCheckoutSession(db, SESSION);
    expect(second.activated).toBe(false);
    expect(tables.subscription_history).toHaveLength(1);
  });

  it('ignores sessions on any other business', async () => {
    const { db, tables } = fakeDb({
      checkout_sessions: [session({ business_id: '99999999-9999-9999-9999-999999999999' })],
      merchants: [{ id: MERCHANT, subscription_plan_id: 'starter' }],
    });
    expect((await activateSubscriptionFromCheckoutSession(db, SESSION)).reason).toBe('not_billing');
    expect(tables.merchants[0].subscription_plan_id).toBe('starter');
  });

  it('refuses a session that charged less than the plan', async () => {
    const { db, tables } = fakeDb({
      checkout_sessions: [session({ amount: 1, metadata: { type: 'subscription_payment', plan_id: 'professional', billing_period: 'yearly' } })],
      merchants: [{ id: MERCHANT, subscription_plan_id: 'starter' }],
    });
    expect((await activateSubscriptionFromCheckoutSession(db, SESSION)).reason).toBe('underpaid');
    expect(tables.merchants[0].subscription_plan_id).toBe('starter');
  });

  it('does nothing for an unpaid session', async () => {
    const { db } = fakeDb({ checkout_sessions: [session({ status: 'open' })], merchants: [] });
    expect((await activateSubscriptionFromCheckoutSession(db, SESSION)).reason).toBe('not_paid');
  });

  it('extends an active plan from its current end date', async () => {
    const end = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const { db, tables } = fakeDb({
      checkout_sessions: [session()],
      merchants: [{ id: MERCHANT, subscription_plan_id: 'professional', subscription_status: 'active', subscription_ends_at: end }],
    });
    await activateSubscriptionFromCheckoutSession(db, SESSION);
    const days = (Date.parse(tables.merchants[0].subscription_ends_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(37);
  });
});

describe('markCheckoutSessionPaidFromWebhook', () => {
  it('will not settle a session from a payment on a different business', async () => {
    const { db, tables } = fakeDb({
      checkout_sessions: [session({ status: 'open' })],
      merchants: [{ id: MERCHANT, subscription_plan_id: 'starter' }],
    });
    const ok = await markCheckoutSessionPaidFromWebhook(db, {
      sessionId: SESSION,
      paymentId: 'attacker-pay',
      method: 'USDC_POL',
      businessId: '99999999-9999-9999-9999-999999999999',
    });
    expect(ok).toBe(false);
    expect(tables.checkout_sessions[0].status).toBe('open');
    expect(tables.merchants[0].subscription_plan_id).toBe('starter');
  });

  it('settles a plan checkout and grants the plan in one call', async () => {
    const { db, tables } = fakeDb({
      checkout_sessions: [session({ status: 'open' })],
      merchants: [{ id: MERCHANT, subscription_plan_id: 'starter' }],
    });
    const ok = await markCheckoutSessionPaidFromWebhook(db, {
      sessionId: SESSION,
      paymentId: 'pay-1',
      method: 'paypal',
      businessId: DEFAULT_BILLING_BUSINESS_ID,
    });
    expect(ok).toBe(true);
    expect(tables.checkout_sessions[0].status).toBe('paid');
    expect(tables.checkout_sessions[0].paid_method).toBe('PAYPAL');
    expect(tables.merchants[0].subscription_plan_id).toBe('professional');
  });
});
