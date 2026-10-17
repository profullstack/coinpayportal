import { describe, it, expect, beforeAll } from 'vitest';
import { invoiceSnapshot, renderInvoiceSnapshot } from './pdf';
import { computeInvoiceTotals } from './line-items';

const base = {
  invoice_number: 'INV-001',
  status: 'sent',
  currency: 'USD',
  due_date: null,
  created_at: '2026-10-17T00:00:00Z',
  businesses: { name: 'Acme' },
};

describe('itemised invoice snapshot', () => {
  beforeAll(() => {
    process.env.INVOICE_PUBLIC_ORIGIN = 'https://coinpayportal.com';
  });

  it('keeps line items and flattens multi-line descriptions', () => {
    const totals = computeInvoiceTotals([{ description: 'Logo\nthree concepts', quantity: 2, unit_price: 50 }]);
    const snap = invoiceSnapshot({ ...base, amount: totals.total, line_items: totals.line_items, subtotal: totals.subtotal });
    expect(snap.line_items?.[0].description).toBe('Logo three concepts');
  });

  it('renders 30 lines on one page', async () => {
    const totals = computeInvoiceTotals(
      Array.from({ length: 30 }, (_, i) => ({ description: `Service ${i + 1}`, quantity: 1, unit_price: 10, tax_rate: 5 }))
    );
    const pdf = await renderInvoiceSnapshot(
      {
        ...base,
        amount: totals.total,
        line_items: totals.line_items,
        subtotal: totals.subtotal,
        discount_total: totals.discount_total,
        tax_total: totals.tax_total,
      },
      '00000000-0000-4000-8000-000000000000'
    );
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('still renders an amount-only invoice', async () => {
    const pdf = await renderInvoiceSnapshot({ ...base, amount: '12.5', line_items: null }, '00000000-0000-4000-8000-000000000000');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
