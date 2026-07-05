import { describe, expect, it, vi } from 'vitest';
import { configureManualMethod } from './policy';

// A table-aware supabase stub: catalog lookups return `catalogRow`, the policy
// status check returns `policyStatus`, and all upserts succeed.
function makeSupabase(catalogRow: any, policyStatus = 'unlocked') {
  const upsert = vi.fn(() => Promise.resolve({ error: null }));
  const client = {
    upsert,
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        upsert,
        single: () =>
          Promise.resolve({
            data:
              table === 'payment_method_catalog'
                ? catalogRow
                : table === 'business_payment_policy'
                  ? { status: policyStatus }
                  : null,
            error: null,
          }),
      };
      return builder;
    },
  };
  return client as any;
}

describe('configureManualMethod', () => {
  const published = { method_id: 'zelle', published: true, force_disabled: false };

  it('rejects an unknown method', async () => {
    const res = await configureManualMethod(makeSupabase(null), 'biz', 'zelle', { handle: 'x@y.com', enabled: true });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('rejects a method the platform has not published', async () => {
    const res = await configureManualMethod(
      makeSupabase({ method_id: 'zelle', published: false, force_disabled: false }),
      'biz',
      'zelle',
      { handle: 'x@y.com', enabled: true }
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
  });

  it('rejects enabling without a handle', async () => {
    const res = await configureManualMethod(makeSupabase(published), 'biz', 'zelle', { handle: '  ', enabled: true });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it('self-unlocks and saves the handle when enabling with a handle', async () => {
    const supabase = makeSupabase(published);
    const res = await configureManualMethod(supabase, 'biz', 'zelle', {
      handle: 'pay@merchant.com',
      instructions: 'note the invoice #',
      enabled: true,
    });
    expect(res.ok).toBe(true);
    // one upsert to unlock the policy, one to write the store setting
    expect(supabase.upsert).toHaveBeenCalledTimes(2);
  });

  it('allows turning off without a handle', async () => {
    const res = await configureManualMethod(makeSupabase(published), 'biz', 'zelle', { handle: '', enabled: false });
    expect(res.ok).toBe(true);
  });
});
