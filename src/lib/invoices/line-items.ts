import { z } from 'zod';

/**
 * Itemised invoices: line items, per-line tax and one invoice-level discount.
 *
 * `invoices.amount` stays the single number every payment path reads (crypto
 * quote, card, PayPal, ACH, the monitor). When an invoice carries line items the
 * server computes that amount here and the caller's `amount` is ignored, so a
 * client can never send lines that add up to one figure and charge another.
 *
 * All arithmetic is in integer cents (BigInt for quantity x price, which can
 * exceed 2^53 at the caps below). Discount is applied before tax, split across
 * lines in proportion to their value, and the rounding remainder lands on the
 * last discounted line so the parts always sum to the whole.
 */

export const MAX_LINE_ITEMS = 100;
const DERIVED_LINE_KEYS = new Set(['amount', 'discount', 'tax']);

const money = (max: number) =>
  z
    .number()
    .finite()
    .min(0)
    .max(max)
    .refine((n) => n === Math.round(n * 100) / 100, 'Use at most two decimals');

export const lineItemSchema = z
  .object({
    item_id: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(1).max(500),
    quantity: z
      .number()
      .finite()
      .positive()
      .max(1_000_000)
      .refine((n) => n === Math.round(n * 10_000) / 10_000, 'Use at most four decimals for quantity'),
    unit_price: money(999_999_999.99),
    tax_rate: z
      .number()
      .finite()
      .min(0)
      .max(100)
      .refine((n) => n === Math.round(n * 1000) / 1000, 'Use at most three decimals for tax rate')
      .nullable()
      .optional(),
    tax_name: z.string().trim().max(64).nullable().optional(),
  })
  .strict();

export const discountSchema = z
  .object({
    type: z.enum(['percent', 'fixed']),
    value: z.number().finite().positive(),
  })
  .strict()
  .refine((d) => d.type !== 'percent' || d.value <= 100, 'A percent discount cannot exceed 100')
  .refine(
    (d) => d.type !== 'fixed' || d.value === Math.round(d.value * 100) / 100,
    'Use at most two decimals'
  );

export const lineItemsSchema = z.array(lineItemSchema).min(1).max(MAX_LINE_ITEMS);

export type LineItemInput = z.infer<typeof lineItemSchema>;
export type Discount = z.infer<typeof discountSchema>;

export type ComputedLine = {
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number | null;
  tax_name: string | null;
  /** quantity x unit_price, before discount and tax. */
  amount: number;
  discount: number;
  tax: number;
};

export type InvoiceTotals = {
  line_items: ComputedLine[];
  discount: Discount | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
};

export class LineItemError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const toCents = (n: number) => BigInt(Math.round(n * 100));
const fromCents = (c: bigint) => Number(c) / 100;

/** Round a / b half away from zero, for non-negative integers. */
function divRound(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}

export function computeInvoiceTotals(
  rawLines: unknown,
  rawDiscount?: unknown
): InvoiceTotals {
  // Stored lines carry derived amount/discount/tax; accept them back on edit
  // and recompute, rather than trusting or rejecting them.
  const stripped = Array.isArray(rawLines)
    ? rawLines.map((l) => {
        if (!l || typeof l !== 'object' || Array.isArray(l)) return l;
        return Object.fromEntries(
          Object.entries(l).filter(([key]) => !DERIVED_LINE_KEYS.has(key))
        );
      })
    : rawLines;
  const linesParsed = lineItemsSchema.safeParse(stripped);
  if (!linesParsed.success) {
    const issue = linesParsed.error.issues[0];
    throw new LineItemError(`line_items${issue.path.length ? '.' + issue.path.join('.') : ''}: ${issue.message}`);
  }
  let discount: Discount | null = null;
  if (rawDiscount !== undefined && rawDiscount !== null) {
    const parsed = discountSchema.safeParse(rawDiscount);
    if (!parsed.success) throw new LineItemError(`discount: ${parsed.error.issues[0].message}`);
    discount = parsed.data;
  }

  const lines = linesParsed.data;
  const lineCents = lines.map((l) => {
    const qty = BigInt(Math.round(l.quantity * 10_000));
    return divRound(qty * toCents(l.unit_price), 10_000n);
  });
  const subtotal = lineCents.reduce((a, b) => a + b, 0n);

  let discountTotal = 0n;
  if (discount) {
    discountTotal =
      discount.type === 'percent'
        ? divRound(subtotal * BigInt(Math.round(discount.value * 1000)), 100_000n)
        : toCents(discount.value);
    if (discountTotal > subtotal) throw new LineItemError('discount: cannot exceed the subtotal');
  }

  // Pro-rata discount per line; the last line with value absorbs the remainder.
  const lineDiscounts = lineCents.map(() => 0n);
  if (discountTotal > 0n) {
    let allocated = 0n;
    let last = -1;
    lineCents.forEach((c, i) => {
      if (c === 0n) return;
      last = i;
      lineDiscounts[i] = (c * discountTotal) / subtotal;
      allocated += lineDiscounts[i];
    });
    lineDiscounts[last] += discountTotal - allocated;
  }

  const lineTaxes = lines.map((l, i) => {
    const rate = l.tax_rate ?? 0;
    if (!rate) return 0n;
    const taxable = lineCents[i] - lineDiscounts[i];
    return divRound(taxable * BigInt(Math.round(rate * 1000)), 100_000n);
  });
  const taxTotal = lineTaxes.reduce((a, b) => a + b, 0n);
  const total = subtotal - discountTotal + taxTotal;

  if (total < 1n) throw new LineItemError('Invoice total must be at least 0.01');
  if (total > 99_999_999_999n) throw new LineItemError('Invoice total is too large');

  return {
    line_items: lines.map((l, i) => ({
      item_id: l.item_id ?? null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      tax_rate: l.tax_rate ? l.tax_rate : null,
      tax_name: l.tax_rate ? l.tax_name || null : null,
      amount: fromCents(lineCents[i]),
      discount: fromCents(lineDiscounts[i]),
      tax: fromCents(lineTaxes[i]),
    })),
    discount,
    subtotal: fromCents(subtotal),
    discount_total: fromCents(discountTotal),
    tax_total: fromCents(taxTotal),
    total: fromCents(total),
  };
}

/** Columns written to `invoices` for an itemised invoice. */
export function itemisedInvoiceColumns(totals: InvoiceTotals) {
  return {
    line_items: totals.line_items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    discount_total: totals.discount_total,
    tax_total: totals.tax_total,
    amount: totals.total,
  };
}

/** Tax grouped by name and rate, for an invoice footer. */
export function taxSummary(lines: Pick<ComputedLine, 'tax_rate' | 'tax_name' | 'tax'>[]) {
  const groups = new Map<string, { name: string; rate: number; amount: number }>();
  for (const l of lines) {
    if (!l.tax_rate || !l.tax) continue;
    const name = l.tax_name || 'Tax';
    const key = `${name}|${l.tax_rate}`;
    const g = groups.get(key) ?? { name, rate: l.tax_rate, amount: 0 };
    g.amount = Math.round((g.amount + l.tax) * 100) / 100;
    groups.set(key, g);
  }
  return [...groups.values()];
}
