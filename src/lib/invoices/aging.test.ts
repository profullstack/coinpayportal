import { describe, it, expect } from 'vitest';
import { arAging, agingBucket } from './aging';

const now = new Date('2026-10-17T12:00:00Z');

describe('AR aging', () => {
  it('buckets by whole days past due', () => {
    expect(agingBucket(null, now)).toBe('current');
    expect(agingBucket('2026-10-20T00:00:00Z', now)).toBe('current');
    expect(agingBucket('2026-10-16T13:00:00Z', now)).toBe('current');
    expect(agingBucket('2026-10-16T11:00:00Z', now)).toBe('1_30');
    expect(agingBucket('2026-09-17T12:00:00Z', now)).toBe('1_30');
    expect(agingBucket('2026-09-16T11:00:00Z', now)).toBe('31_60');
    expect(agingBucket('2026-07-01T00:00:00Z', now)).toBe('90_plus');
  });

  it('totals per currency and per client, biggest debtor first', () => {
    const r = arAging(
      [
        { id: '1', currency: 'USD', amount: '100.10', due_date: '2026-10-01T00:00:00Z', client_id: 'a', clients: { name: 'Ann', company_name: null, email: null } },
        { id: '2', currency: 'USD', amount: '0.20', due_date: null, client_id: 'a', clients: { name: 'Ann', company_name: null, email: null } },
        { id: '3', currency: 'USD', amount: '500', due_date: '2026-06-01T00:00:00Z', client_id: 'b', clients: { name: null, company_name: 'Bco', email: null } },
        { id: '4', currency: 'EUR', amount: '9', due_date: null, client_id: null },
      ],
      now
    );
    expect(r.totals).toEqual([
      { currency: 'USD', current: 0.2, '1_30': 100.1, '31_60': 0, '61_90': 0, '90_plus': 500, total: 600.3 },
      { currency: 'EUR', current: 9, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 9 },
    ]);
    expect(r.clients.map((c) => [c.name, c.total, c.invoices])).toEqual([
      ['Bco', 500, 1],
      ['Ann', 100.3, 2],
      ['No client', 9, 1],
    ]);
  });
});
