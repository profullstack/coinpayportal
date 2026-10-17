import { describe, it, expect } from 'vitest';
import { computeInvoiceTotals, LineItemError, taxSummary } from './line-items';

describe('computeInvoiceTotals', () => {
  it('sums quantity x price with no tax or discount', () => {
    const t = computeInvoiceTotals([
      { description: 'Design', quantity: 3, unit_price: 100 },
      { description: 'Hosting', quantity: 1, unit_price: 19.99 },
    ]);
    expect(t.subtotal).toBe(319.99);
    expect(t.tax_total).toBe(0);
    expect(t.discount_total).toBe(0);
    expect(t.total).toBe(319.99);
    expect(t.line_items[0].amount).toBe(300);
  });

  it('applies per-line tax', () => {
    const t = computeInvoiceTotals([
      { description: 'Widget', quantity: 2, unit_price: 50, tax_rate: 8.25, tax_name: 'CA' },
      { description: 'Labor', quantity: 1, unit_price: 100 },
    ]);
    expect(t.subtotal).toBe(200);
    expect(t.tax_total).toBe(8.25);
    expect(t.total).toBe(208.25);
    expect(t.line_items[1].tax_name).toBeNull();
  });

  it('handles fractional quantities exactly', () => {
    const t = computeInvoiceTotals([{ description: 'Hours', quantity: 1.5, unit_price: 123.45 }]);
    // 185.175 rounds half up to 185.18
    expect(t.total).toBe(185.18);
  });

  it('applies a percent discount before tax, split pro rata', () => {
    const t = computeInvoiceTotals(
      [
        { description: 'A', quantity: 1, unit_price: 100, tax_rate: 10 },
        { description: 'B', quantity: 1, unit_price: 100 },
      ],
      { type: 'percent', value: 10 }
    );
    expect(t.discount_total).toBe(20);
    expect(t.line_items[0].discount).toBe(10);
    expect(t.line_items[1].discount).toBe(10);
    // Tax on A's discounted 90
    expect(t.tax_total).toBe(9);
    expect(t.total).toBe(189);
  });

  it('puts the fixed-discount rounding remainder on the last line', () => {
    const t = computeInvoiceTotals(
      [
        { description: 'A', quantity: 1, unit_price: 10 },
        { description: 'B', quantity: 1, unit_price: 10 },
        { description: 'C', quantity: 1, unit_price: 10 },
      ],
      { type: 'fixed', value: 10 }
    );
    const sum = t.line_items.reduce((a, l) => a + Math.round(l.discount * 100), 0);
    expect(sum).toBe(1000);
    expect(t.total).toBe(20);
  });

  it('refuses a discount above the subtotal', () => {
    expect(() =>
      computeInvoiceTotals([{ description: 'A', quantity: 1, unit_price: 5 }], { type: 'fixed', value: 6 })
    ).toThrow(LineItemError);
  });

  it('refuses a zero total', () => {
    expect(() => computeInvoiceTotals([{ description: 'Free', quantity: 1, unit_price: 0 }])).toThrow(
      /at least 0.01/
    );
  });

  it('refuses malformed lines with a path', () => {
    expect(() => computeInvoiceTotals([{ description: '', quantity: 1, unit_price: 5 }])).toThrow(
      /line_items\.0\.description/
    );
    expect(() => computeInvoiceTotals([{ description: 'x', quantity: 1, unit_price: 1.001 }])).toThrow(
      /two decimals/
    );
    expect(() => computeInvoiceTotals([])).toThrow(LineItemError);
    expect(() =>
      computeInvoiceTotals([{ description: 'x', quantity: 1, unit_price: 1, sneaky: true }])
    ).toThrow(LineItemError);
  });

  it('recomputes stored lines instead of trusting their derived fields', () => {
    const stored = computeInvoiceTotals([{ description: 'A', quantity: 2, unit_price: 10 }]).line_items;
    const forged = stored.map((l) => ({ ...l, amount: 1, tax: 0, discount: 0 }));
    expect(computeInvoiceTotals(forged).total).toBe(20);
  });

  it('stays exact at the caps', () => {
    // 0.3333 x 999,999,999.99 = 333,299,999.996667: past 2^53 in float cents x 10^4.
    const t = computeInvoiceTotals([{ description: 'Big', quantity: 0.3333, unit_price: 999_999_999.99 }]);
    expect(t.total).toBe(333_300_000);
    expect(() =>
      computeInvoiceTotals([{ description: 'Too big', quantity: 2, unit_price: 999_999_999.99 }])
    ).toThrow(/too large/);
  });
});

describe('taxSummary', () => {
  it('groups tax by name and rate', () => {
    const t = computeInvoiceTotals([
      { description: 'A', quantity: 1, unit_price: 100, tax_rate: 5, tax_name: 'GST' },
      { description: 'B', quantity: 1, unit_price: 100, tax_rate: 5, tax_name: 'GST' },
      { description: 'C', quantity: 1, unit_price: 100, tax_rate: 7, tax_name: 'PST' },
    ]);
    expect(taxSummary(t.line_items)).toEqual([
      { name: 'GST', rate: 5, amount: 10 },
      { name: 'PST', rate: 7, amount: 7 },
    ]);
  });
});
