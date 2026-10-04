import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payinEffectFor, applyPayinTransition } from './payin';
import type { BankTransferRow } from './store';

vi.mock('@/lib/webhooks/service', () => ({
  sendPaymentWebhook: vi.fn().mockResolvedValue({ success: true }),
}));

import { sendPaymentWebhook } from '@/lib/webhooks/service';

const base: BankTransferRow = {
  id: 'btx_1',
  merchant_id: 'm',
  business_id: 'b',
  provider: 'column',
  provider_transfer_id: 'acht_1',
  direction: 'debit',
  kind: 'payin',
  payment_id: 'pay_1',
  invoice_id: null,
  payer_email: null,
  amount_minor: 10_000,
  fee_minor: 100,
  net_minor: 9_900,
  currency: 'USD',
  status: 'settled',
  provider_status: 'SETTLED',
  return_code: null,
  counterparty_id: 'cpty_1',
  bank_counterparty_id: 'bcp_1',
  description: null,
  idempotency_key: 'payin:payment:pay_1:1',
  created_at: '2026-09-10T00:00:00.000Z',
  settled_at: '2026-09-12T00:00:00.000Z',
  hold_until: '2026-09-17T00:00:00.000Z',
  completed_at: null,
  returned_at: null,
  last_polled_at: null,
  last_error: null,
  updated_at: '2026-09-12T00:00:00.000Z',
};

describe('payinEffectFor', () => {
  it('confirms only on completion, never at settlement', () => {
    expect(payinEffectFor({ ...base, status: 'pending' }, base)).toBeNull();
    expect(payinEffectFor(base, { ...base, status: 'completed', completed_at: 'x' })).toBe('confirm');
  });

  it('reverses a return that lands after completion, and ignores one before it', () => {
    const completed = { ...base, status: 'completed' as const, completed_at: '2026-09-17T00:00:00.000Z' };
    expect(payinEffectFor(completed, { ...completed, status: 'returned', return_code: 'R10' })).toBe('reverse');
    // Returned before ever completing: the payment was never confirmed, nothing to reverse.
    expect(payinEffectFor(base, { ...base, status: 'returned' })).toBeNull();
  });

  it('is idempotent across repeated ticks and ignores other kinds', () => {
    const completed = { ...base, status: 'completed' as const, completed_at: 'x' };
    expect(payinEffectFor(completed, completed)).toBeNull();
    expect(payinEffectFor({ ...base, kind: 'funding' }, { ...base, kind: 'funding', status: 'completed', completed_at: 'x' })).toBeNull();
  });
});

describe('applyPayinTransition', () => {
  function fakeSupabase(row: Record<string, unknown> | null, updatedRows: unknown[] = [{ id: 'x' }]) {
    const calls: { table: string; op: string; args: unknown[] }[] = [];
    const chain = (table: string) => {
      const self: Record<string, unknown> = {};
      const record = (op: string) => (...args: unknown[]) => {
        calls.push({ table, op, args });
        return self;
      };
      for (const op of ['select', 'eq', 'neq', 'update']) self[op] = record(op);
      self.maybeSingle = async () => ({ data: row });
      // `.select('id')` after an update resolves the update; make the chain thenable.
      self.then = (resolve: (v: unknown) => void) => resolve({ data: updatedRows });
      return self;
    };
    return { client: { from: (table: string) => chain(table) }, calls };
  }

  beforeEach(() => {
    vi.mocked(sendPaymentWebhook).mockClear();
  });

  it('marks the payment confirmed and tells the merchant on completion', async () => {
    const { client, calls } = fakeSupabase({ id: 'pay_1', business_id: 'b', amount: '100.00', currency: 'USD', metadata: {}, status: 'pending' });
    const after = { ...base, status: 'completed' as const, completed_at: '2026-09-17T00:00:00.000Z' };
    const effect = await applyPayinTransition(client as never, base, after);
    expect(effect).toBe('confirm');
    const update = calls.find((c) => c.table === 'payments' && c.op === 'update');
    expect(update?.args[0]).toMatchObject({ status: 'confirmed' });
    // Conditional on the current status, so a repeated tick cannot confirm twice.
    expect(calls.some((c) => c.op === 'eq' && c.args[0] === 'status' && c.args[1] === 'pending')).toBe(true);
    expect(sendPaymentWebhook).toHaveBeenCalledWith(expect.anything(), 'b', 'pay_1', 'payment.confirmed', expect.objectContaining({ status: 'confirmed' }));
  });

  it('does not notify when the conditional update matched nothing', async () => {
    const { client } = fakeSupabase({ id: 'pay_1', business_id: 'b', amount: '100.00', currency: 'USD', metadata: {}, status: 'confirmed' }, []);
    const after = { ...base, status: 'completed' as const, completed_at: 'x' };
    await applyPayinTransition(client as never, base, after);
    expect(sendPaymentWebhook).not.toHaveBeenCalled();
  });

  it('fails the payment and tells the merchant on a return after completion', async () => {
    const { client, calls } = fakeSupabase({ id: 'pay_1', business_id: 'b', amount: '100.00', currency: 'USD', metadata: {}, status: 'confirmed' });
    const completed = { ...base, status: 'completed' as const, completed_at: 'x' };
    const returned = { ...completed, status: 'returned' as const, return_code: 'R10', returned_at: 'y' };
    expect(await applyPayinTransition(client as never, completed, returned)).toBe('reverse');
    const update = calls.find((c) => c.table === 'payments' && c.op === 'update');
    expect(update?.args[0]).toMatchObject({ status: 'failed' });
    expect(sendPaymentWebhook).toHaveBeenCalledWith(expect.anything(), 'b', 'pay_1', 'payment.failed', expect.objectContaining({ error: expect.stringContaining('R10') }));
  });

  it('marks an invoice paid with settlement_method ach', async () => {
    const { client, calls } = fakeSupabase({ id: 'inv_1', business_id: 'b', invoice_number: 'INV-1', amount: '100.00', currency: 'USD', metadata: {}, status: 'sent' });
    const invoiceRow = { ...base, payment_id: null, invoice_id: 'inv_1' };
    const after = { ...invoiceRow, status: 'completed' as const, completed_at: 'x' };
    await applyPayinTransition(client as never, invoiceRow, after);
    const update = calls.find((c) => c.table === 'invoices' && c.op === 'update');
    expect(update?.args[0]).toMatchObject({ status: 'paid', settlement_method: 'ach' });
    expect(sendPaymentWebhook).toHaveBeenCalledWith(expect.anything(), 'b', 'inv_1', 'invoice.paid', expect.objectContaining({ payment_rail: 'ach' }));
  });
});
