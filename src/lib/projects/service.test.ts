import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/entitlements/service', () => ({ isBusinessPaidTier: async () => false }));
vi.mock('@/lib/invoices/numbering', () => ({
  insertWithInvoiceNumber: async (_db: unknown, _b: string, build: (n: string) => Promise<unknown>) => build('INV-050'),
}));

import { linesFromEntries, elapsedMinutes, billProjectTime, entrySchema } from './service';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  description: 'Design review',
  started_at: '2026-10-17T15:00:00Z',
  minutes: 90,
  billable: true,
  hourly_rate: null,
  invoice_id: null,
  ...over,
});

describe('time entry helpers', () => {
  it('turns entries into hour lines at the project or entry rate', () => {
    expect(linesFromEntries([entry(), entry({ id: 'e2', description: '', minutes: 20, hourly_rate: 200 })], 'Site', 120)).toEqual([
      { description: 'Design review (Oct 17)', quantity: 1.5, unit_price: 120 },
      { description: 'Site (Oct 17)', quantity: 0.3333, unit_price: 200 },
    ]);
  });

  it('counts at least one minute', () => {
    expect(elapsedMinutes('2026-10-17T15:00:00Z', new Date('2026-10-17T15:00:10Z'))).toBe(1);
    expect(elapsedMinutes('2026-10-17T15:00:00Z', new Date('2026-10-17T16:29:40Z'))).toBe(90);
  });

  it('wants minutes or a timer start, not both', () => {
    const p = '00000000-0000-4000-8000-000000000001';
    expect(entrySchema.safeParse({ project_id: p, minutes: 30 }).success).toBe(true);
    expect(entrySchema.safeParse({ project_id: p, start: true }).success).toBe(true);
    expect(entrySchema.safeParse({ project_id: p }).success).toBe(false);
    expect(entrySchema.safeParse({ project_id: p, start: true, minutes: 5 }).success).toBe(false);
  });
});

describe('billProjectTime', () => {
  let entries: any[];
  let invoices: any[];
  let stolen: boolean;

  function db() {
    return {
      from(table: string) {
        const q: any = {
          _f: [] as Array<(r: any) => boolean>,
          _patch: null as any,
          _del: false,
          select() { return q; },
          eq(c: string, v: unknown) { q._f.push((r: any) => r[c] === v); return q; },
          in(c: string, v: unknown[]) { q._f.push((r: any) => v.includes(r[c])); return q; },
          is(c: string, v: unknown) { q._f.push((r: any) => (r[c] ?? null) === v); return q; },
          not(c: string) { q._f.push((r: any) => r[c] != null); return q; },
          order() { return q; },
          update(p: any) { q._patch = p; return q; },
          delete() { q._del = true; return q; },
          insert(row: any) {
            const inv = { id: 'inv-new', ...row };
            invoices.push(inv);
            return { select: () => ({ single: async () => ({ data: inv, error: null }) }) };
          },
          maybeSingle: async () => ({
            data: table === 'projects' ? { id: 'p1', business_id: 'b1', client_id: 'c1', name: 'Site', hourly_rate: 100, currency: 'USD' } : null,
          }),
          single: async () => ({ data: { merchant_id: 'm1' } }),
          then(resolve: (v: unknown) => void) {
            const src = table === 'invoices' ? invoices : entries;
            let rows = src.filter((r: any) => q._f.every((f: any) => f(r)));
            if (q._patch) {
              if (stolen && q._patch.invoice_id) rows = rows.slice(1);
              rows.forEach((r: any) => Object.assign(r, q._patch));
            }
            if (q._del) rows.forEach((r: any) => src.splice(src.indexOf(r), 1));
            resolve({ data: rows, error: null });
          },
        };
        return q;
      },
    } as any;
  }

  beforeEach(() => {
    entries = [
      entry({ project_id: 'p1' }),
      entry({ id: 'e2', project_id: 'p1', minutes: 30 }),
      entry({ id: 'e3', project_id: 'p1', billable: false }),
      entry({ id: 'e4', project_id: 'p1', minutes: null }),
    ];
    invoices = [];
    stolen = false;
  });

  it('bills finished billable time as an itemised draft and claims the entries', async () => {
    const result = await billProjectTime(db(), 'p1');
    expect(result).toMatchObject({ ok: true, entries: 2, invoice: { amount: 200 } });
    expect(invoices[0]).toMatchObject({ status: 'draft', client_id: 'c1', subtotal: 200 });
    expect(entries.filter((e) => e.invoice_id === 'inv-new').map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('undoes the invoice when another bill claimed some of the time first', async () => {
    stolen = true;
    const result = await billProjectTime(db(), 'p1');
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(invoices).toHaveLength(0);
    expect(entries.every((e) => e.invoice_id == null)).toBe(true);
  });
});
