import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent = vi.hoisted(() => ({ emails: [] as Array<{ to: string; subject: string }>, delivered: [] as string[] }));
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => (sent.emails.push(m), { success: true })),
}));
vi.mock('@/lib/email/invoice-delivery', () => ({
  getInvoicePaymentLink: (id: string) => `https://coinpayportal.com/now/${id}`,
  deliverInvoiceEmail: vi.fn(async (inv: { id: string }) => (sent.delivered.push(inv.id), { success: true })),
}));
vi.mock('./activation', () => ({
  activateInvoicePayment: vi.fn(async (_db: unknown, inv: Record<string, unknown>) => ({
    ok: true,
    invoice: { ...inv, status: 'sent' },
  })),
}));
vi.mock('./numbering', () => ({
  insertWithInvoiceNumber: vi.fn(async (_db: unknown, _b: string, build: (n: string) => Promise<unknown>) => build('INV-900')),
}));

import { runReminderCycle } from './reminders';

type Row = Record<string, any>;
let invoices: Row[];
let settings: Row[];
let reminders: Row[];
let inserted: Row[];

function db() {
  return {
    from(table: string) {
      const q: any = {
        _filters: [] as Array<(r: Row) => boolean>,
        select() { return q; },
        in(col: string, vals: unknown[]) { q._filters.push((r: Row) => vals.includes(r[col])); return q; },
        not() { return q; },
        gte() { return q; },
        lte() { return q; },
        eq(col: string, v: unknown) { q._filters.push((r: Row) => r[col] === v); return q; },
        update(patch: Row) { q._patch = patch; return q; },
        insert(row: Row) {
          if (table === 'invoice_reminders') {
            const dup = reminders.some((r) => r.invoice_id === row.invoice_id && r.kind === row.kind && r.offset_days === row.offset_days);
            const id = `rem-${reminders.length + 1}`;
            if (!dup) reminders.push({ id, status: 'pending', ...row });
            return { select: () => ({ maybeSingle: async () => (dup ? { data: null, error: { code: '23505' } } : { data: { id }, error: null }) }) };
          }
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'fee-1', ...row, clients: { email: 'client@example.com' }, businesses: { name: 'Acme' } }, error: null }) }) };
        },
        then(resolve: (v: unknown) => void) {
          const source = table === 'invoices' ? invoices : table === 'invoice_settings' ? settings : reminders;
          const rows = source.filter((r) => q._filters.every((f: (r: Row) => boolean) => f(r)));
          if (q._patch) rows.forEach((r) => Object.assign(r, q._patch));
          resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  } as any;
}

const invoice = (over: Row = {}): Row => ({
  id: 'inv-1',
  invoice_number: 'INV-007',
  status: 'overdue',
  amount: '200.00',
  currency: 'USD',
  crypto_currency: 'USDC_SOL',
  merchant_wallet_address: 'payee',
  fee_rate: 0.01,
  due_date: '2026-10-10T12:00:00Z',
  business_id: 'b1',
  user_id: 'u1',
  client_id: 'c1',
  late_fee_for_invoice_id: null,
  metadata: {},
  clients: { id: 'c1', email: 'client@example.com' },
  businesses: { id: 'b1', name: 'Acme', merchant_id: 'u1' },
  ...over,
});

describe('runReminderCycle', () => {
  beforeEach(() => {
    invoices = [invoice()];
    settings = [];
    reminders = [];
    inserted = [];
    sent.emails = [];
    sent.delivered = [];
  });

  it('sends the default on-due reminder exactly once across cycles', async () => {
    const now = new Date('2026-10-10T13:00:00Z');
    expect((await runReminderCycle(db(), now)).reminders).toBe(1);
    expect((await runReminderCycle(db(), now)).reminders).toBe(0);
    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0].subject).toContain('OVERDUE');
    expect(reminders[0]).toMatchObject({ kind: 'reminder', offset_days: 0, status: 'sent' });
  });

  it('sends a before-due reminder with the friendly template', async () => {
    invoices = [invoice({ status: 'sent' })];
    settings = [{ business_id: 'b1', reminder_days: [-3, 0], reminders_enabled: true, late_fee_type: 'none', late_fee_after_days: 0 }];
    await runReminderCycle(db(), new Date('2026-10-07T13:00:00Z'));
    expect(sent.emails[0].subject).toBe('Reminder: invoice INV-007 from Acme is due in 3 days');
  });

  it('records a skip when the client has no email', async () => {
    invoices = [invoice({ clients: { id: 'c1', email: null } })];
    const stats = await runReminderCycle(db(), new Date('2026-10-10T13:00:00Z'));
    expect(stats.skipped).toBe(1);
    expect(reminders[0].status).toBe('skipped');
  });

  it('issues one linked late-fee invoice and never charges a fee on a fee', async () => {
    settings = [{ business_id: 'b1', reminder_days: [], reminders_enabled: true, late_fee_type: 'percent', late_fee_value: 1.5, late_fee_after_days: 3 }];
    const now = new Date('2026-10-13T13:00:00Z');
    const stats = await runReminderCycle(db(), now);
    expect(stats.lateFees).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      late_fee_for_invoice_id: 'inv-1',
      amount: 3,
      crypto_currency: 'USDC_SOL',
      status: 'draft',
    });
    expect(inserted[0].line_items[0].description).toBe('Late fee (1.5%) on INV-007');
    expect(sent.delivered).toEqual(['fee-1']);

    invoices.push(invoice({ id: 'fee-1', late_fee_for_invoice_id: 'inv-1', due_date: '2026-10-10T12:00:00Z' }));
    await runReminderCycle(db(), now);
    expect(inserted).toHaveLength(1);
  });
});
