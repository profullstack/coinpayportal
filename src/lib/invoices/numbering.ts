import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-business invoice numbering.
 *
 * Four call sites generated `INV-NNN` and only one of them did it correctly.
 * The other three (`F-1.3-10`, `NEW-F1A-P-01`, `R4-DIN-07`) shared two defects:
 *
 *  1. **Ordering by `created_at` and taking the first row.** The highest
 *     *number* is not the newest *row*. Backdate an invoice, import a
 *     historical one, or delete the most recent, and the "maximum" is whatever
 *     happens to sort first by time — so the next number collides with one that
 *     already exists.
 *
 *  2. **No retry on the unique violation.** `(business_id, invoice_number)` is
 *     unique, so two concurrent creates both read the same maximum, both
 *     compute the same next number, and the loser's insert fails with 23505.
 *     In `convertToInvoice` that surfaces as a proposal that will not convert;
 *     in the recurring scheduler it halts the subscription, because the cycle
 *     throws and the schedule is never advanced.
 *
 * Both are fixed here, once, so the four sites cannot drift apart again — which
 * is how three of them ended up wrong while the fourth was right.
 */

/**
 * The next free number for a business, by parsed value rather than row order.
 *
 * Reads every numbered invoice for the business. That is a full scan per call,
 * but invoice counts per business are small (tens to hundreds) and correctness
 * here is worth more than the round trip — the alternative is a sequence, which
 * is a schema change and would still need the retry below for imports.
 */
export async function nextInvoiceNumber(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  const { data: rows } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('business_id', businessId)
    .not('invoice_number', 'is', null);

  let highest = 0;
  for (const row of rows || []) {
    const match = String((row as { invoice_number: unknown }).invoice_number).match(/INV-(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > highest) highest = n;
    }
  }

  return `INV-${String(highest + 1).padStart(3, '0')}`;
}

export interface InsertAttemptResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/**
 * Insert an invoice, retrying on the unique-violation a concurrent create causes.
 *
 * Each retry re-reads the maximum, so two racing requests end up with
 * consecutive numbers rather than one failing outright. Only 23505 is retried;
 * anything else is a real failure and is returned immediately.
 *
 * @param attemptInsert - performs the insert with the supplied number. Kept as
 *   a callback because the four call sites select different columns back and
 *   write different rows; the only thing they need to share is the numbering.
 */
export async function insertWithInvoiceNumber<T>(
  supabase: SupabaseClient,
  businessId: string,
  attemptInsert: (invoiceNumber: string) => PromiseLike<InsertAttemptResult<T>>,
  maxAttempts = 5
): Promise<InsertAttemptResult<T>> {
  let invoiceNumber = await nextInvoiceNumber(supabase, businessId);
  let result: InsertAttemptResult<T> = { data: null, error: null };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    result = await attemptInsert(invoiceNumber);

    // 23505 = unique_violation. Anything else is a real failure.
    if (!result.error || result.error.code !== '23505') return result;

    invoiceNumber = await nextInvoiceNumber(supabase, businessId);
  }

  return result;
}
