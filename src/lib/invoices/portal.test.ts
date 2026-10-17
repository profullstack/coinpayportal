import { describe, it, expect } from 'vitest';
import { loadPortal, newPortalToken, PORTAL_TOKEN_PATTERN } from './portal';

function db(client: Record<string, unknown> | null, invoices: Array<Record<string, unknown>>) {
  const filters: Array<[string, unknown]> = [];
  return {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        in: (c: string, v: unknown[]) => (filters.push([c, v]), q),
        order: () => q,
        limit: async () => ({ data: invoices.filter((i) => ['sent', 'overdue', 'paid'].includes(i.status as string)) }),
        maybeSingle: async () => ({ data: table === 'clients' ? client : null }),
      };
      return q;
    },
    filters,
  } as any;
}

const token = newPortalToken();

describe('client portal', () => {
  it('mints 43-character url-safe tokens', () => {
    expect(token).toMatch(PORTAL_TOKEN_PATTERN);
    expect(newPortalToken()).not.toBe(token);
  });

  it('refuses malformed tokens without querying', async () => {
    const d = db({ id: 'c1' }, []);
    expect(await loadPortal(d, 'short')).toBeNull();
    expect(d.filters).toHaveLength(0);
  });

  it('totals what is outstanding per currency and hides drafts', async () => {
    const portal = await loadPortal(
      db({ id: 'c1', business_id: 'b1', name: 'Jo', company_name: null, businesses: { name: 'Acme' } }, [
        { id: '1', status: 'sent', currency: 'USD', amount: '100.10' },
        { id: '2', status: 'overdue', currency: 'USD', amount: '0.20' },
        { id: '3', status: 'paid', currency: 'USD', amount: '50' },
        { id: '4', status: 'sent', currency: 'EUR', amount: '9' },
        { id: '5', status: 'draft', currency: 'USD', amount: '999' },
      ]),
      token
    );
    expect(portal?.business.name).toBe('Acme');
    expect(portal?.invoices.map((i) => i.id)).toEqual(['1', '2', '3', '4']);
    expect(portal?.outstanding).toEqual([
      { currency: 'USD', amount: 100.3 },
      { currency: 'EUR', amount: 9 },
    ]);
  });

  it('is null for an unknown token', async () => {
    expect(await loadPortal(db(null, []), token)).toBeNull();
  });
});
