import { describe, it, expect } from 'vitest';
import { tallyInvoices, hasActivity, renderWeeklyPaymentsEmail, type WeeklyPayments } from './weekly-payments';

const start = new Date('2026-10-12T15:00:00.000Z');
const end = new Date('2026-10-19T15:00:00.000Z');

describe('weekly payments report', () => {
  it('tallies invoices paid and issued in the window, and what is overdue now', () => {
    const t = tallyInvoices(
      [
        { status: 'paid', amount: '100', currency: 'USD', paid_at: '2026-10-14T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
        { status: 'paid', amount: '50', currency: 'USD', paid_at: '2026-10-01T00:00:00Z', created_at: '2026-09-20T00:00:00Z' },
        { status: 'sent', amount: '25.5', currency: 'USD', paid_at: null, created_at: '2026-10-18T00:00:00Z' },
        { status: 'overdue', amount: '10', currency: 'USD', paid_at: null, created_at: '2026-09-01T00:00:00Z' },
        { status: 'paid', amount: '0.1', currency: 'ETH', paid_at: '2026-10-15T00:00:00Z', created_at: '2026-10-15T00:00:00Z' },
      ],
      start,
      end,
    );
    expect(t).toEqual({ paid: 2, paidAmount: 100, issued: 2, issuedAmount: 25.5, overdue: 1, overdueAmount: 10, currency: 'USD' });
  });

  it('a week with only expired checkouts or a stale overdue invoice has nothing to say', () => {
    const quiet = { payments: 0, inFlight: 0, invoices: { paid: 0, paidAmount: 0, issued: 0, issuedAmount: 0, overdue: 3, overdueAmount: 30, currency: 'USD' } };
    expect(hasActivity(quiet)).toBe(false);
    expect(hasActivity({ ...quiet, payments: 1 })).toBe(true);
    expect(hasActivity({ ...quiet, invoices: { ...quiet.invoices, issued: 1 } })).toBe(true);
  });

  it('renders the total, escapes business names and carries the footer', () => {
    const report: WeeklyPayments = {
      merchantId: 'm',
      merchantEmail: 'dan@example.com',
      windowStart: start,
      windowEnd: end,
      received: 1234.5,
      currency: 'USD',
      payments: 3,
      inFlight: 1,
      failed: 7,
      businesses: [
        { businessId: 'b1', name: '<Shop>', received: 1234.5, currency: 'USD', payments: 3, inFlight: 1 },
        { businessId: 'b2', name: 'Idle', received: 0, currency: 'USD', payments: 0, inFlight: 0 },
      ],
      invoices: { paid: 1, paidAmount: 100, issued: 0, issuedAmount: 0, overdue: 0, overdueAmount: 0, currency: 'USD' },
    };
    const { subject, html } = renderWeeklyPaymentsEmail(report, '<p>FOOTER</p>');
    expect(subject).toBe('CoinPay weekly payments: $1,234.50 received, 2026-10-12 to 2026-10-19');
    expect(html).toContain('&lt;Shop&gt;');
    expect(html).not.toContain('Idle');
    expect(html).toContain('<p>FOOTER</p>');
    expect(html).toContain('1 paid ($100.00)');
  });
});
