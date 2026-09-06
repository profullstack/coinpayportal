import { describe, expect, it } from 'vitest';
import {
  aggregateNightlySummary,
  renderNightlySummaryEmail,
  formatMoney,
  type NightlySummary,
} from './nightly-summary';

/**
 * A Supabase stub that answers the three reads the aggregator makes, in
 * whatever order it makes them.
 */
function client(opts: {
  merchant?: { id: string; email: string | null } | null;
  businesses?: { id: string; name: string }[];
  payments?: { business_id: string; amount: string | null; currency: string | null; status: string }[];
}) {
  const build = (table: string): any => {
    const result =
      table === 'merchants'
        ? { data: opts.merchant ?? null }
        : table === 'businesses'
          ? { data: opts.businesses ?? [] }
          : { data: opts.payments ?? [] };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      gte: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  return { from: (table: string) => build(table) } as any;
}

const NOW = new Date('2026-09-06T09:00:00Z');

describe('aggregateNightlySummary', () => {
  it('counts only settled payments, and ranks businesses by what they took', async () => {
    const summary = await aggregateNightlySummary(
      client({
        merchant: { id: 'm1', email: 'a@b.com' },
        businesses: [
          { id: 'b1', name: 'Small Shop' },
          { id: 'b2', name: 'Big Shop' },
        ],
        payments: [
          { business_id: 'b1', amount: '10.00', currency: 'USD', status: 'confirmed' },
          { business_id: 'b2', amount: '250.00', currency: 'USD', status: 'forwarded' },
          { business_id: 'b2', amount: '99.00', currency: 'USD', status: 'detected' },
          { business_id: 'b1', amount: '5.00', currency: 'USD', status: 'failed' },
        ],
      }),
      'm1',
      NOW,
    );

    expect(summary).not.toBeNull();
    // 99.00 is detected, not settled, so it is excluded from the total.
    expect(summary!.received).toBe(260);
    expect(summary!.payments).toBe(2);
    expect(summary!.inFlight).toBe(1);
    expect(summary!.failed).toBe(1);
    expect(summary!.businesses.map((b) => b.name)).toEqual(['Big Shop', 'Small Shop']);
  });

  it('returns a zeroed summary when a merchant has businesses but no payments', async () => {
    const summary = await aggregateNightlySummary(
      client({
        merchant: { id: 'm1', email: 'a@b.com' },
        businesses: [{ id: 'b1', name: 'Quiet Shop' }],
        payments: [],
      }),
      'm1',
      NOW,
    );
    expect(summary!.received).toBe(0);
    expect(summary!.payments).toBe(0);
    expect(summary!.businesses).toHaveLength(1);
  });

  it('skips a merchant with no email', async () => {
    const summary = await aggregateNightlySummary(
      client({ merchant: { id: 'm1', email: null } }),
      'm1',
      NOW,
    );
    expect(summary).toBeNull();
  });

  it('treats an unparseable amount as zero rather than NaN', async () => {
    const summary = await aggregateNightlySummary(
      client({
        merchant: { id: 'm1', email: 'a@b.com' },
        businesses: [{ id: 'b1', name: 'Shop' }],
        payments: [{ business_id: 'b1', amount: null, currency: 'USD', status: 'confirmed' }],
      }),
      'm1',
      NOW,
    );
    expect(summary!.received).toBe(0);
    expect(Number.isNaN(summary!.received)).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats a real currency', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
  });

  it('falls back for a crypto ticker Intl does not know', () => {
    expect(formatMoney(0.00051, 'BTC')).toBe('0.00051 BTC');
  });
});

const summary = (overrides: Partial<NightlySummary> = {}): NightlySummary => ({
  merchantId: 'm1',
  merchantEmail: 'a@b.com',
  windowStart: new Date('2026-09-05T09:00:00Z'),
  windowEnd: NOW,
  received: 260,
  currency: 'USD',
  payments: 2,
  inFlight: 1,
  failed: 0,
  businesses: [
    { businessId: 'b2', name: 'Big Shop', received: 250, currency: 'USD', payments: 1, inFlight: 1 },
    { businessId: 'b1', name: 'Small Shop', received: 10, currency: 'USD', payments: 1, inFlight: 0 },
  ],
  ...overrides,
});

describe('renderNightlySummaryEmail', () => {
  it('puts the money in the subject', () => {
    expect(renderNightlySummaryEmail(summary()).subject).toBe(
      'CoinPay nightly — $260.00 across 2 payments',
    );
  });

  it('says so plainly on a quiet day', () => {
    const { subject } = renderNightlySummaryEmail(
      summary({ received: 0, payments: 0, inFlight: 0, businesses: [] }),
    );
    expect(subject).toBe('CoinPay nightly — no payments in the last 24 hours');
  });

  it('keeps businesses in the order given, busiest first', () => {
    const { html } = renderNightlySummaryEmail(summary());
    expect(html.indexOf('Big Shop')).toBeLessThan(html.indexOf('Small Shop'));
  });

  it('escapes a business name rather than trusting it', () => {
    const { html } = renderNightlySummaryEmail(
      summary({
        businesses: [
          { businessId: 'b1', name: '<script>x</script>', received: 1, currency: 'USD', payments: 1, inFlight: 0 },
        ],
      }),
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
