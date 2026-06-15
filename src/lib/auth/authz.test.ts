import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveBusinessRole,
  resolveOrgRole,
  authorizeBusiness,
  getAccessibleBusinessRoles,
  listAccessibleBusinessIds,
} from './authz';

/**
 * Minimal in-memory Supabase stand-in. Each table is an array of rows; the chainable
 * builder applies .eq()/.in() filters and resolves (await / .maybeSingle()) to the
 * matching rows. Enough to exercise the authz query shapes.
 */
type Rows = Record<string, any[]>;

function makeSupabase(tables: Rows): SupabaseClient {
  const client = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          rows = rows.filter((r) => vals.includes(r[col]));
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        single() {
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (v: { data: any[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

const OWNER = 'merchant-owner';
const ORG_ADMIN = 'merchant-org-admin';
const BIZ_WRITER = 'merchant-biz-writer';
const STRANGER = 'merchant-stranger';

const ORG = 'org-1';
const BIZ_A = 'biz-a'; // in ORG, owned by OWNER
const BIZ_B = 'biz-b'; // in ORG, owned by OWNER

function fixture() {
  return makeSupabase({
    businesses: [
      { id: BIZ_A, merchant_id: OWNER, organization_id: ORG },
      { id: BIZ_B, merchant_id: OWNER, organization_id: ORG },
    ],
    organizations: [{ id: ORG, owner_merchant_id: OWNER }],
    organization_members: [
      { organization_id: ORG, merchant_id: OWNER, role: 'owner' },
      { organization_id: ORG, merchant_id: ORG_ADMIN, role: 'admin' },
    ],
    business_members: [
      // BIZ_WRITER is a writer on BIZ_A only.
      { business_id: BIZ_A, merchant_id: BIZ_WRITER, role: 'writer' },
    ],
  });
}

describe('resolveBusinessRole', () => {
  it('returns owner for the business owner', async () => {
    expect(await resolveBusinessRole(fixture(), OWNER, BIZ_A)).toBe('owner');
  });

  it('returns org role for an org member across all businesses in the org', async () => {
    expect(await resolveBusinessRole(fixture(), ORG_ADMIN, BIZ_A)).toBe('admin');
    expect(await resolveBusinessRole(fixture(), ORG_ADMIN, BIZ_B)).toBe('admin');
  });

  it('returns the direct business-member role', async () => {
    expect(await resolveBusinessRole(fixture(), BIZ_WRITER, BIZ_A)).toBe('writer');
  });

  it('does not leak a business-scoped role to sibling businesses', async () => {
    expect(await resolveBusinessRole(fixture(), BIZ_WRITER, BIZ_B)).toBeNull();
  });

  it('returns null for a stranger', async () => {
    expect(await resolveBusinessRole(fixture(), STRANGER, BIZ_A)).toBeNull();
  });

  it('returns the highest role when both business and org membership apply', async () => {
    const sb = makeSupabase({
      businesses: [{ id: BIZ_A, merchant_id: OWNER, organization_id: ORG }],
      organizations: [{ id: ORG, owner_merchant_id: OWNER }],
      organization_members: [{ organization_id: ORG, merchant_id: 'm', role: 'admin' }],
      business_members: [{ business_id: BIZ_A, merchant_id: 'm', role: 'readonly' }],
    });
    expect(await resolveBusinessRole(sb, 'm', BIZ_A)).toBe('admin');
  });

  it('returns null for an unknown business', async () => {
    expect(await resolveBusinessRole(fixture(), OWNER, 'nope')).toBeNull();
  });
});

describe('resolveOrgRole', () => {
  it('owner and member roles resolve; stranger is null', async () => {
    expect(await resolveOrgRole(fixture(), OWNER, ORG)).toBe('owner');
    expect(await resolveOrgRole(fixture(), ORG_ADMIN, ORG)).toBe('admin');
    expect(await resolveOrgRole(fixture(), STRANGER, ORG)).toBeNull();
  });
});

describe('authorizeBusiness', () => {
  it('allows when role has the capability', async () => {
    const res = await authorizeBusiness(fixture(), ORG_ADMIN, BIZ_A, 'team.manage');
    expect(res).toEqual({ ok: true, role: 'admin' });
  });

  it('403 when role lacks the capability (admin cannot move funds)', async () => {
    const res = await authorizeBusiness(fixture(), ORG_ADMIN, BIZ_A, 'funds.move');
    expect(res).toEqual({ ok: false, status: 403, error: 'Insufficient permissions' });
  });

  it('404 when the user has no access at all (no existence leak)', async () => {
    const res = await authorizeBusiness(fixture(), STRANGER, BIZ_A, 'business.read');
    expect(res).toEqual({ ok: false, status: 404, error: 'Business not found' });
  });

  it('writer can write invoices but not rotate api keys', async () => {
    expect((await authorizeBusiness(fixture(), BIZ_WRITER, BIZ_A, 'invoice.write')).ok).toBe(true);
    expect((await authorizeBusiness(fixture(), BIZ_WRITER, BIZ_A, 'apikey.manage')).ok).toBe(false);
  });
});

describe('getAccessibleBusinessRoles / listAccessibleBusinessIds', () => {
  it('owner sees all owned businesses as owner', async () => {
    const roles = await getAccessibleBusinessRoles(fixture(), OWNER);
    expect(roles.get(BIZ_A)).toBe('owner');
    expect(roles.get(BIZ_B)).toBe('owner');
  });

  it('org member sees every business in the org at their role', async () => {
    const roles = await getAccessibleBusinessRoles(fixture(), ORG_ADMIN);
    expect([...roles.keys()].sort()).toEqual([BIZ_A, BIZ_B]);
    expect(roles.get(BIZ_A)).toBe('admin');
  });

  it('business member sees only their business', async () => {
    const ids = await listAccessibleBusinessIds(fixture(), BIZ_WRITER);
    expect(ids).toEqual([BIZ_A]);
  });

  it('stranger sees nothing', async () => {
    expect(await listAccessibleBusinessIds(fixture(), STRANGER)).toEqual([]);
  });
});
