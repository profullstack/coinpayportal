/**
 * Recurring invoice scheduler — revocation and payee guards.
 *
 * The scheduler runs unattended under the service role, so nothing downstream
 * re-checks who authorized a series. These cover the three ways that used to go
 * wrong: a cancelled template that kept minting, a payee copied through after
 * the account could no longer justify it, and a series left running with no
 * resolvable payee at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPaymentReceivingWallet = vi.fn();

vi.mock('../wallets/supported-coins', () => ({
  getPaymentReceivingWallet: (...args: any[]) => mockGetPaymentReceivingWallet(...args),
}));

import { runInvoiceSchedulerCycle } from './monitor-invoices';

// Valid base58 Solana addresses (32-44 chars), so the real payee validator runs.
const TEMPLATE_PAYEE = 'CsTWZTbDryjcb229RQ9b7wny5qytH9jwoJy6Lu98xpeF';
const CONFIGURED_PAYEE = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

const NOW = new Date('2026-08-04T00:00:00Z');

type Ctx = { table: string; op: string; payload?: any; filters: Record<string, any> };

interface Recorded {
  inserts: any[];
  scheduleUpdates: Array<{ payload: any; filters: Record<string, any> }>;
}

function makeSupabase(schedules: any[]) {
  const recorded: Recorded = { inserts: [], scheduleUpdates: [] };

  const from = vi.fn((table: string) => {
    const ctx: Ctx = { table, op: 'select', filters: {} };
    const builder: any = {
      select: () => builder,
      insert: (payload: any) => { ctx.op = 'insert'; ctx.payload = payload; return builder; },
      update: (payload: any) => { ctx.op = 'update'; ctx.payload = payload; return builder; },
      eq: (col: string, val: any) => { ctx.filters[col] = val; return builder; },
      // Invoice numbering scans every numbered invoice for the business
      // (F-1.3-10 / R4-DIN-07), so the chain now includes `.not()`.
      not: () => builder,
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => builder,
      then: (resolve: any, reject: any) => {
        let result: any = { data: null, error: null };
        if (ctx.table === 'invoice_schedules') {
          if (ctx.op === 'update') {
            recorded.scheduleUpdates.push({ payload: ctx.payload, filters: ctx.filters });
          } else {
            result = { data: schedules, error: null };
          }
        } else if (ctx.table === 'invoices') {
          if (ctx.op === 'insert') {
            recorded.inserts.push(ctx.payload);
            result = { data: null, error: null };
          } else {
            // The numbering helper reads ALL numbered invoices and takes the
            // highest parsed value, rather than ordering by created_at and
            // trusting the first row — so this answers with a list.
            result = { data: [{ invoice_number: 'INV-011' }], error: null };
          }
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  });

  return { supabase: { from } as any, recorded };
}

function makeSchedule(overrides: Record<string, any> = {}, invoiceOverrides: Record<string, any> = {}) {
  return {
    id: 'sched-1',
    invoice_id: 'inv-template',
    recurrence: 'monthly',
    custom_interval_days: null,
    next_due_date: '2026-08-04T00:00:00Z',
    end_date: null,
    max_occurrences: null,
    occurrences_count: 1,
    active: true,
    invoices: {
      id: 'inv-template',
      invoice_number: 'INV-003',
      status: 'sent',
      user_id: 'merch-1',
      business_id: 'biz-1',
      client_id: 'client-1',
      currency: 'USD',
      amount: '800.00',
      crypto_currency: 'SOL',
      merchant_wallet_address: TEMPLATE_PAYEE,
      wallet_id: 'wallet-1',
      fee_rate: '0.010000',
      notes: null,
      ...invoiceOverrides,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPaymentReceivingWallet.mockResolvedValue({ walletAddress: TEMPLATE_PAYEE, source: 'business' });
});

describe('runInvoiceSchedulerCycle — template revocation', () => {
  it('stops a series whose template invoice was cancelled, and mints nothing', async () => {
    const { supabase, recorded } = makeSupabase([makeSchedule({}, { status: 'cancelled' })]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.created).toBe(0);
    expect(stats.deactivated).toBe(1);
    expect(stats.errors).toBe(0);
    expect(recorded.inserts).toHaveLength(0);
    expect(recorded.scheduleUpdates).toEqual([
      { payload: { active: false }, filters: { id: 'sched-1' } },
    ]);
  });

  it('keeps minting for a template that is still live', async () => {
    const { supabase, recorded } = makeSupabase([makeSchedule({}, { status: 'sent' })]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.created).toBe(1);
    expect(stats.deactivated).toBe(0);
    expect(recorded.inserts).toHaveLength(1);
    expect(recorded.inserts[0]).toMatchObject({
      status: 'draft',
      business_id: 'biz-1',
      amount: '800.00',
      merchant_wallet_address: TEMPLATE_PAYEE,
    });
  });

  it.each(['draft', 'sent', 'paid', 'overdue'])('does not stop on a %s template', async status => {
    const { supabase } = makeSupabase([makeSchedule({}, { status })]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.deactivated).toBe(0);
    expect(stats.created).toBe(1);
  });
});

describe('runInvoiceSchedulerCycle — payee guards', () => {
  it('flags the invoice when the payee is not one of the account wallets', async () => {
    mockGetPaymentReceivingWallet.mockResolvedValue({ walletAddress: CONFIGURED_PAYEE, source: 'business' });
    const { supabase, recorded } = makeSupabase([makeSchedule()]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.created).toBe(1);
    // The template's address is still honoured — merchants do use external
    // payees — but it is marked for a human to confirm before sending.
    expect(recorded.inserts[0].merchant_wallet_address).toBe(TEMPLATE_PAYEE);
    expect(recorded.inserts[0].metadata.payee_unverified).toBe(true);
  });

  it('does not flag when the payee matches the account wallet', async () => {
    const { supabase, recorded } = makeSupabase([makeSchedule()]);

    await runInvoiceSchedulerCycle(supabase, NOW);

    expect(recorded.inserts[0].metadata.payee_unverified).toBeUndefined();
    expect(recorded.inserts[0].metadata).toMatchObject({ recurring: true, schedule_id: 'sched-1' });
  });

  it('stops the series when no payee can be resolved at all', async () => {
    mockGetPaymentReceivingWallet.mockResolvedValue({ error: 'no wallet configured' });
    const { supabase, recorded } = makeSupabase([
      makeSchedule({}, { merchant_wallet_address: null }),
    ]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.created).toBe(0);
    expect(stats.deactivated).toBe(1);
    expect(recorded.inserts).toHaveLength(0);
  });

  it('re-resolves a blank template payee from the account wallet rather than emitting a blank one', async () => {
    mockGetPaymentReceivingWallet.mockResolvedValue({ walletAddress: CONFIGURED_PAYEE, source: 'business' });
    const { supabase, recorded } = makeSupabase([
      makeSchedule({}, { merchant_wallet_address: null }),
    ]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.created).toBe(1);
    expect(recorded.inserts[0].merchant_wallet_address).toBe(CONFIGURED_PAYEE);
    // wallet_id described the template's address, which is not where this landed.
    expect(recorded.inserts[0].wallet_id).toBeNull();
  });
});

describe('runInvoiceSchedulerCycle — existing limits still hold', () => {
  it('stops at max_occurrences', async () => {
    const { supabase, recorded } = makeSupabase([
      makeSchedule({ max_occurrences: 3, occurrences_count: 3 }),
    ]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.deactivated).toBe(1);
    expect(recorded.inserts).toHaveLength(0);
  });

  it('stops after end_date', async () => {
    const { supabase, recorded } = makeSupabase([
      makeSchedule({ end_date: '2026-07-01T00:00:00Z' }),
    ]);

    const stats = await runInvoiceSchedulerCycle(supabase, NOW);

    expect(stats.deactivated).toBe(1);
    expect(recorded.inserts).toHaveLength(0);
  });
});
