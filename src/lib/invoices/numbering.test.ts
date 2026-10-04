import { describe, expect, it, vi } from 'vitest';
import { nextInvoiceNumber, insertWithInvoiceNumber } from './numbering';

/**
 * Regression tests for the invoice-numbering family
 * (`F-1.3-10`, `NEW-F1A-P-01`, `R4-DIN-07`).
 *
 * Four call sites generated `INV-NNN`; three of them ordered by `created_at`
 * and took the newest row, which is not the row with the highest number, and
 * none of the three retried the unique violation a concurrent create causes.
 */

function supabaseReturning(rows: { invoice_number: unknown }[]) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return { from: vi.fn(() => chain) } as any;
}

describe('nextInvoiceNumber', () => {
  it('starts at INV-001 for a business with no invoices', async () => {
    expect(await nextInvoiceNumber(supabaseReturning([]), 'biz')).toBe('INV-001');
  });

  it('takes the highest parsed number, not the newest row', async () => {
    // The bug in one assertion. Ordering by `created_at` and reading the first
    // row returns whichever invoice happens to sort first by time — so a
    // backdated or imported invoice makes the "maximum" too low and the next
    // number collides with one that already exists.
    const rows = [
      { invoice_number: 'INV-002' },
      { invoice_number: 'INV-017' },
      { invoice_number: 'INV-009' },
    ];
    expect(await nextInvoiceNumber(supabaseReturning(rows), 'biz')).toBe('INV-018');
  });

  it('ignores rows whose number does not parse', async () => {
    const rows = [
      { invoice_number: 'INV-004' },
      { invoice_number: 'LEGACY-XYZ' },
      { invoice_number: null },
    ];
    expect(await nextInvoiceNumber(supabaseReturning(rows), 'biz')).toBe('INV-005');
  });

  it('keeps padding to three digits and grows past it', async () => {
    expect(await nextInvoiceNumber(supabaseReturning([{ invoice_number: 'INV-008' }]), 'b')).toBe('INV-009');
    expect(await nextInvoiceNumber(supabaseReturning([{ invoice_number: 'INV-999' }]), 'b')).toBe('INV-1000');
  });
});

describe('insertWithInvoiceNumber', () => {
  it('retries on a unique violation and advances the number', async () => {
    // Two concurrent creates read the same maximum and compute the same next
    // number; without this retry the loser's insert simply fails — which in
    // convertToInvoice meant a proposal that would not convert, and in the
    // recurring scheduler halted the subscription.
    const supabase = supabaseReturning([{ invoice_number: 'INV-003' }]);
    const attempted: string[] = [];

    const attemptInsert = vi.fn(async (invoiceNumber: string) => {
      attempted.push(invoiceNumber);
      if (attempted.length === 1) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      return { data: { id: 'inv-1' }, error: null };
    });

    const result = await insertWithInvoiceNumber(supabase, 'biz', attemptInsert);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: 'inv-1' });
    expect(attempted).toHaveLength(2);
  });

  it('does not retry an error that is not a unique violation', async () => {
    // A permissions failure or a bad column is not a numbering collision, and
    // retrying it four more times only delays the real error.
    const supabase = supabaseReturning([]);
    const attemptInsert = vi.fn(async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }));

    const result = await insertWithInvoiceNumber(supabase, 'biz', attemptInsert);

    expect(result.error?.code).toBe('42501');
    expect(attemptInsert).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt cap rather than looping forever', async () => {
    const supabase = supabaseReturning([]);
    const attemptInsert = vi.fn(async () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    }));

    const result = await insertWithInvoiceNumber(supabase, 'biz', attemptInsert, 3);

    expect(attemptInsert).toHaveBeenCalledTimes(3);
    expect(result.error?.code).toBe('23505');
  });

  it('succeeds first time when there is no contention', async () => {
    const supabase = supabaseReturning([{ invoice_number: 'INV-041' }]);
    const attemptInsert = vi.fn(async (invoiceNumber: string) => ({
      data: { invoice_number: invoiceNumber },
      error: null,
    }));

    const result = await insertWithInvoiceNumber(supabase, 'biz', attemptInsert);

    expect(attemptInsert).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ invoice_number: 'INV-042' });
  });
});
