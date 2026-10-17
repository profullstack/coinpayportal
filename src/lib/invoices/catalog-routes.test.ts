import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({
  merchant: { merchantId: 'm1', apiKeyBusinessId: null as string | null },
  role: { ok: true } as { ok: boolean; status?: number; error?: string },
}));
const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, { business_id: string }>>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@/lib/auth/merchant', () => ({ resolveMerchant: async () => auth.merchant }));
vi.mock('@/lib/auth/authz', () => ({ authorizeBusiness: async () => auth.role }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => ((filters[col] = val), chain),
        neq: () => chain,
        order: () => chain,
        update: () => chain,
        maybeSingle: async () => ({ data: db.rows[table]?.[filters.id as string] ?? null }),
        insert(row: Record<string, unknown>) {
          db.inserts.push({ table, row });
          return { select: () => ({ single: async () => ({ data: { id: 'new', ...row }, error: null }) }) };
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

import { collectionRoutes, itemRoutes } from './catalog-routes';

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer x' } });

describe('catalog routes', () => {
  beforeEach(() => {
    auth.merchant = { merchantId: 'm1', apiKeyBusinessId: null };
    auth.role = { ok: true };
    db.rows = {};
    db.inserts = [];
  });

  it('creates a tax rate on the authorized business', async () => {
    const res = await collectionRoutes('tax_rates').POST(
      post('http://x/api/tax-rates', { business_id: 'b1', name: 'GST', rate: 5 })
    );
    expect(res.status).toBe(201);
    expect(db.inserts[0].row).toEqual({ business_id: 'b1', name: 'GST', rate: 5 });
  });

  it('refuses an API key naming another business', async () => {
    auth.merchant = { merchantId: 'm1', apiKeyBusinessId: 'b1' };
    const res = await collectionRoutes('tax_rates').POST(
      post('http://x/api/tax-rates', { business_id: 'b2', name: 'GST', rate: 5 })
    );
    expect(res.status).toBe(403);
    expect(db.inserts).toHaveLength(0);
  });

  it("refuses an item pointing at another business's tax rate", async () => {
    db.rows.tax_rates = { '00000000-0000-4000-8000-000000000002': { business_id: 'b2' } };
    const res = await collectionRoutes('invoice_items').POST(
      post('http://x/api/invoice-items', {
        business_id: 'b1',
        name: 'Design',
        unit_price: 100,
        tax_rate_id: '00000000-0000-4000-8000-000000000002',
      })
    );
    expect(res.status).toBe(400);
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects unknown fields and bad rates', async () => {
    const routes = collectionRoutes('tax_rates');
    expect((await routes.POST(post('http://x/api/tax-rates', { business_id: 'b1', name: 'X', rate: 101 }))).status).toBe(400);
    expect(
      (await routes.POST(post('http://x/api/tax-rates', { business_id: 'b1', name: 'X', rate: 1, id: 'forced' }))).status
    ).toBe(400);
  });

  it('answers 404, not 403, for a row in a business the caller cannot read', async () => {
    const id = '00000000-0000-4000-8000-000000000009';
    db.rows.invoice_items = { [id]: { business_id: 'b9' } };
    auth.role = { ok: false, status: 403, error: 'Insufficient permissions' };
    const res = await itemRoutes('invoice_items').GET(
      new NextRequest('http://x/api/invoice-items/' + id, { headers: { authorization: 'Bearer x' } }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(404);
  });
});
