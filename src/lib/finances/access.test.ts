import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const OWNER = '11111111-1111-4111-8111-111111111111';
const MOM = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

let signedIn = MOM;
vi.mock('@/lib/auth/merchant-guard', () => {
  const guard = async () => ({ id: signedIn, email: `${signedIn}@x.test` });
  return { requireMerchant: guard, requireMerchantForWrite: guard };
});

// organization_members rows: { merchant_id, role, finance_access, owner }
let memberships: Array<{ merchant_id: string; role: string; finance_access: boolean; owner: string }> = [];
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => ((filters[col] = val), builder),
        in: () => builder,
        maybeSingle: async () => ({ data: table === 'merchants' ? { email: 'owner@x.test' } : null }),
        then: (resolve: any) => {
          if (table !== 'organization_members') return Promise.resolve({ data: [] }).then(resolve);
          const rows = memberships
            .filter((m) => m.merchant_id === filters.merchant_id)
            .filter((m) => filters.finance_access === undefined || m.finance_access === filters.finance_access)
            .filter((m) => !filters['organizations.owner_merchant_id'] || m.owner === filters['organizations.owner_merchant_id'])
            .map((m) => ({ role: m.role, organizations: { name: 'Profullstack', owner_merchant_id: m.owner } }));
          return Promise.resolve({ data: rows }).then(resolve);
        },
      };
      return builder;
    },
  }),
}));

import { requireFinanceAccess } from './access';

function req(owner?: string) {
  return new NextRequest('https://coinpayportal.com/api/finances/summary', {
    headers: owner ? { 'x-finance-owner': owner } : {},
  });
}

beforeEach(() => {
  signedIn = MOM;
  memberships = [{ merchant_id: MOM, role: 'readonly', finance_access: true, owner: OWNER }];
});

describe('requireFinanceAccess', () => {
  it('defaults to your own books as owner', async () => {
    const r = await requireFinanceAccess(req(), 'finance.connect');
    expect(r).toMatchObject({ id: MOM, actorId: MOM, role: 'owner' });
  });

  it('lets a granted teammate read the owner books, scoped to the owner id', async () => {
    const r = await requireFinanceAccess(req(OWNER), 'finance.read');
    expect(r).toMatchObject({ id: OWNER, actorId: MOM, role: 'readonly', email: 'owner@x.test' });
  });

  it('caps the teammate by role', async () => {
    const r = await requireFinanceAccess(req(OWNER), 'finance.write', { write: true });
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(403);
  });

  it('404s without a finance grant, even for an org member', async () => {
    memberships = [{ merchant_id: MOM, role: 'admin', finance_access: false, owner: OWNER }];
    const r = await requireFinanceAccess(req(OWNER), 'finance.read');
    expect((r as NextResponse).status).toBe(404);
  });

  it('404s for books of someone you have no org with', async () => {
    const r = await requireFinanceAccess(req(STRANGER), 'finance.read');
    expect((r as NextResponse).status).toBe(404);
  });

  it('never makes a teammate the owner of somebody else books', async () => {
    memberships = [{ merchant_id: MOM, role: 'owner', finance_access: true, owner: OWNER }];
    const ok = await requireFinanceAccess(req(OWNER), 'finance.manage', { write: true });
    expect(ok).toMatchObject({ role: 'admin' });
    const denied = await requireFinanceAccess(req(OWNER), 'finance.connect', { write: true });
    expect((denied as NextResponse).status).toBe(403);
  });

  it('rejects a malformed owner id', async () => {
    const r = await requireFinanceAccess(req('not-a-uuid'), 'finance.read');
    expect((r as NextResponse).status).toBe(400);
  });
});
