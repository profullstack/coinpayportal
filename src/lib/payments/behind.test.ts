import { describe, it, expect } from 'vitest';
import { buildBehindReport, type CardRow, type InvoiceRow } from './behind';
import { explainDecline } from './decline-reasons';
import { draftEmail } from './behind-email';

const now = new Date('2026-09-20T12:00:00Z');
const biz = { business_id: 'biz-1', businesses: { name: 'Acme' } };

const card = (over: Partial<CardRow>): CardRow => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  amount: 39000,
  currency: 'gbp',
  status: 'failed',
  customer_email: 'ops@northgate.example',
  customer_name: 'Northgate Logistics',
  created_at: '2026-09-02T10:00:00Z',
  ...biz,
  ...over,
});

const invoice = (over: Partial<InvoiceRow>): InvoiceRow => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  invoice_number: 'INV-1',
  status: 'overdue',
  currency: 'USD',
  amount: '500.00',
  due_date: '2026-09-10T00:00:00Z',
  created_at: '2026-08-25T00:00:00Z',
  client_id: 'client-1',
  clients: { name: 'Jo', company_name: 'Bluefin Ltd', email: 'jo@bluefin.example' },
  ...biz,
  ...over,
});

describe('explainDecline', () => {
  it('sorts the codes seen in prod into actions', () => {
    expect(explainDecline('insufficient_funds').action).toBe('retry');
    expect(explainDecline('generic_decline').action).toBe('call_bank');
    expect(explainDecline('do_not_honor').action).toBe('call_bank');
    expect(explainDecline('payment_intent_payment_attempt_expired').action).toBe('unfinished');
    expect(explainDecline('payment_intent_authentication_failure').action).toBe('unfinished');
    expect(explainDecline('fraudulent').action).toBe('do_not_chase');
    expect(explainDecline('incorrect_number').action).toBe('new_card');
  });

  it('falls back to the raw message for an unknown code, never the placeholder', () => {
    expect(explainDecline('weird_code', 'Bank said no')).toEqual({ action: 'call_bank', reason: 'Bank said no' });
    expect(explainDecline(null, 'Card payment failed').reason).toBe('The bank declined it without giving a reason.');
  });
});

describe('buildBehindReport', () => {
  it('reproduces the Northgate card: three declines, long history, never missed', () => {
    const cards = [
      card({ status: 'completed', created_at: '2026-03-01T00:00:00Z' }),
      card({ status: 'completed', created_at: '2026-04-01T00:00:00Z' }),
      card({ failure_code: 'insufficient_funds', created_at: '2026-09-02T00:00:00Z' }),
      card({ failure_code: 'insufficient_funds', created_at: '2026-09-05T00:00:00Z' }),
      card({ failure_code: 'insufficient_funds', created_at: '2026-09-09T00:00:00Z' }),
    ];
    const r = buildBehindReport(cards, [], { now });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].action).toBe('retry');
    const c = r.groups[0].customers[0];
    expect(c.name).toBe('Northgate Logistics');
    expect(c.items).toHaveLength(3);
    expect(c.items[0].date).toBe('2026-09-09T00:00:00Z'); // newest first
    expect(c.items[0].detail).toBe('Not enough money in the account at the time.');
    // Three retries of one charge are one debt.
    expect(c.owed).toEqual([{ currency: 'GBP', amount: 390 }]);
    expect(c.history.line).toBe('Paying since Mar 2026 · never missed before');
    expect(r.counts).toEqual({ customers: 1, invoices: 0, card_failures: 3 });
    expect(r.summary).toContain('1 customer is behind on £390.00');
    expect(r.summary).toContain('1 is likely to go through on a retry');
  });

  it('drops a failure that a later payment cleared', () => {
    const cards = [
      card({ failure_code: 'insufficient_funds', created_at: '2026-09-02T00:00:00Z' }),
      card({ status: 'completed', created_at: '2026-09-03T00:00:00Z' }),
    ];
    const r = buildBehindReport(cards, [], { now });
    expect(r.counts.customers).toBe(0);
    expect(r.summary).toMatch(/^Nobody is behind/);
  });

  it('drops card failures older than the window', () => {
    const r = buildBehindReport([card({ created_at: '2026-01-01T00:00:00Z' })], [], { now, cardWindowDays: 90 });
    expect(r.counts.customers).toBe(0);
  });

  it('joins an overdue invoice and a declined card for the same email into one person', () => {
    const r = buildBehindReport(
      [card({ customer_email: 'JO@bluefin.example', customer_name: null, failure_code: 'expired_card' })],
      [invoice({})],
      { now },
    );
    expect(r.counts.customers).toBe(1);
    const c = r.groups[0].customers[0];
    expect(c.name).toBe('Bluefin Ltd');
    expect(c.action).toBe('new_card');
    expect(c.items.map((i) => i.kind).sort()).toEqual(['card', 'invoice']);
    expect(c.owed).toEqual(
      expect.arrayContaining([
        { currency: 'USD', amount: 500 },
        { currency: 'GBP', amount: 390 },
      ]),
    );
  });

  it('keeps the same email at two businesses as two people', () => {
    const r = buildBehindReport([], [invoice({}), invoice({ business_id: 'biz-2', businesses: { name: 'Other' } })], { now });
    expect(r.counts.customers).toBe(2);
  });

  it('groups invoices by lateness and delivery', () => {
    const r = buildBehindReport(
      [],
      [
        invoice({ id: 'a', clients: { name: 'A', company_name: null, email: 'a@x.example' }, due_date: '2026-09-15T00:00:00Z' }),
        invoice({ id: 'b', clients: { name: 'B', company_name: null, email: 'b@x.example' }, due_date: '2026-07-01T00:00:00Z' }),
        invoice({ id: 'c', clients: { name: 'C', company_name: null, email: 'c@x.example' }, email_status: 'failed', email_last_error: 'mailbox not found' }),
        // Sent and not yet due is not behind.
        invoice({ id: 'd', status: 'sent', clients: { name: 'D', company_name: null, email: 'd@x.example' }, due_date: '2026-10-01T00:00:00Z' }),
        // Sent and past due counts even before a job flips it to overdue.
        invoice({ id: 'e', status: 'sent', clients: { name: 'E', company_name: null, email: 'e@x.example' }, due_date: '2026-09-18T00:00:00Z' }),
      ],
      { now },
    );
    const by = Object.fromEntries(r.groups.map((g) => [g.action, g.customers.map((c) => c.name)]));
    expect(by).toEqual({ unreachable: ['C'], chase: ['B'], remind: expect.arrayContaining(['A', 'E']) });
    expect(r.groups.map((g) => g.action)).toEqual(['unreachable', 'chase', 'remind']);
    const c = r.groups[0].customers[0];
    expect(c.items[0].detail).toBe('The invoice email failed: mailbox not found.');
    expect(r.counts.invoices).toBe(4);
  });

  it('a fraud flag overrides every other action, and the summary warns', () => {
    const r = buildBehindReport([card({ failure_code: 'fraudulent', customer_email: 'jo@bluefin.example' })], [invoice({})], { now });
    expect(r.groups[0].action).toBe('do_not_chase');
    expect(r.summary).toContain("1 card was flagged by the bank; don't retry it.");
  });

  it('counts late-paid invoices and earlier declines as misses', () => {
    const r = buildBehindReport(
      [
        card({ customer_email: 'jo@bluefin.example', failure_code: 'generic_decline', created_at: '2026-05-01T00:00:00Z' }),
        card({ customer_email: 'jo@bluefin.example', status: 'completed', created_at: '2026-05-02T00:00:00Z' }),
      ],
      [
        invoice({ id: 'p', status: 'paid', due_date: '2026-06-01T00:00:00Z', paid_at: '2026-06-20T00:00:00Z' }),
        invoice({}),
      ],
      { now },
    );
    expect(r.groups[0].customers[0].history.line).toBe('Paying since May 2026 · missed 2 times before');
  });

  it('a customer who has never paid says so', () => {
    const r = buildBehindReport([], [invoice({})], { now });
    expect(r.groups[0].customers[0].history.line).toBe('Has never paid you');
  });

  it('drafts an email that never tells the holder of a flagged card why', () => {
    const r = buildBehindReport([card({ failure_code: 'stolen_card' })], [], { now });
    const url = draftEmail(r.groups[0].customers[0])!;
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(url.startsWith('mailto:ops%40northgate.example?')).toBe(true);
    expect(body).toContain('was declined');
    expect(body).not.toMatch(/stolen|fraud|lost|flag/i);
  });

  it('drafts a reminder naming invoice and amount; no email address means no draft', () => {
    const r = buildBehindReport([], [invoice({ invoice_number: 'INV-7' })], { now });
    const url = decodeURIComponent(draftEmail(r.groups[0].customers[0])!);
    expect(url).toContain('Invoice INV-7 from Acme');
    expect(url).toContain('$500.00');
    const none = buildBehindReport([], [invoice({ clients: null, client_id: null })], { now });
    expect(draftEmail(none.groups[0].customers[0])).toBeNull();
  });

  it('sorts customers in a group by what they owe, largest first', () => {
    const r = buildBehindReport(
      [],
      [
        invoice({ id: 's', amount: '10', clients: { name: 'Small', company_name: null, email: 's@x.example' } }),
        invoice({ id: 'l', amount: '900', clients: { name: 'Large', company_name: null, email: 'l@x.example' } }),
      ],
      { now },
    );
    expect(r.groups[0].customers.map((c) => c.name)).toEqual(['Large', 'Small']);
  });
});
