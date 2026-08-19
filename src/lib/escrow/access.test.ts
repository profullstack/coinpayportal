import { describe, expect, it } from 'vitest';
import { callerOwnsEscrow } from './access';
import type { AuthContext } from '../auth/middleware';

/**
 * Regression tests for CP-021 and NEW-15 (2026-08-19 audit).
 *
 * `GET /api/escrow/:id` and `/events` authenticated the caller and then fetched
 * the escrow by UUID with no ownership check, so any merchant's API key read any
 * escrow: counterparty emails, amounts, address hashes, dispute reasons.
 */

const OWNER_BIZ = 'biz-owner';
const OTHER_BIZ = 'biz-other';

const ESCROW = {
  business_id: OWNER_BIZ,
  depositor_email: 'Depositor@Example.com',
  beneficiary_email: 'beneficiary@example.com',
};

const businessKey = (businessId: string): AuthContext => ({
  type: 'business',
  businessId,
  merchantId: 'm-1',
  businessName: 'Biz',
  scopes: ['*'],
});

const merchantJwt = (merchantId: string): AuthContext => ({
  type: 'merchant',
  merchantId,
  email: 'ignored@example.com',
});

/** Supabase double: merchant email lookup plus the accessible-business set. */
function makeSupabase(opts: { email?: string; businesses?: string[] } = {}) {
  return {
    from(table: string) {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.email ? { email: opts.email } : null }),
            }),
          }),
        };
      }
      if (table === 'businesses') {
        return {
          select: () => ({
            eq: () => ({
              data: (opts.businesses ?? []).map((id) => ({ id, merchant_id: 'someone' })),
            }),
          }),
        };
      }
      // business_members / organization_members: no rows.
      return {
        select: () => ({
          eq: () => ({ data: [], error: null }),
        }),
      };
    },
  } as never;
}

describe('callerOwnsEscrow', () => {
  it('lets a business key read its own escrow', async () => {
    const ok = await callerOwnsEscrow(makeSupabase(), businessKey(OWNER_BIZ), ESCROW);
    expect(ok).toBe(true);
  });

  it('refuses a business key pointed at another business escrow', async () => {
    const ok = await callerOwnsEscrow(makeSupabase(), businessKey(OTHER_BIZ), ESCROW);
    expect(ok).toBe(false);
  });

  it('refuses a business key when the escrow has no business at all', async () => {
    const ok = await callerOwnsEscrow(makeSupabase(), businessKey(OWNER_BIZ), {
      ...ESCROW,
      business_id: null,
    });
    expect(ok).toBe(false);
  });

  it('lets the depositor read it, matching email case-insensitively', async () => {
    const supabase = makeSupabase({ email: 'depositor@example.com' });
    const ok = await callerOwnsEscrow(supabase, merchantJwt('m-dep'), ESCROW);
    expect(ok).toBe(true);
  });

  it('lets the beneficiary read it', async () => {
    const supabase = makeSupabase({ email: 'beneficiary@example.com' });
    const ok = await callerOwnsEscrow(supabase, merchantJwt('m-ben'), ESCROW);
    expect(ok).toBe(true);
  });

  it('refuses an unrelated merchant holding a perfectly valid credential', async () => {
    // The finding in one line: authentication succeeded, and that used to be
    // the end of the check.
    const supabase = makeSupabase({ email: 'stranger@example.com' });
    const ok = await callerOwnsEscrow(supabase, merchantJwt('m-stranger'), ESCROW);
    expect(ok).toBe(false);
  });
});
