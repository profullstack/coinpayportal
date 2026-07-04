import { beforeEach, describe, expect, it } from 'vitest';
import {
  mergeEffective,
  resolveEffectivePaymentMethods,
  invalidateBusiness,
  invalidateAll,
} from './resolver';
import { setMerchantMethodSetting } from './policy';
import type { CatalogMethod, BusinessPolicy, MerchantSetting } from './types';

function catalog(over: Partial<CatalogMethod> = {}): CatalogMethod {
  return {
    methodId: 'zelle',
    displayName: 'Zelle',
    integrationType: 'zelle_deposit_match',
    published: true,
    forceDisabled: false,
    defaultConfig: {},
    featureFlags: {},
    sortOrder: 90,
    ...over,
  };
}
function policyMap(entries: BusinessPolicy[]): Map<string, BusinessPolicy> {
  return new Map(entries.map((e) => [e.methodId, e]));
}
function settingsMap(entries: MerchantSetting[]): Map<string, MerchantSetting> {
  return new Map(entries.map((e) => [e.methodId, e]));
}
function setting(over: Partial<MerchantSetting> = {}): MerchantSetting {
  return {
    methodId: 'zelle',
    enabled: true,
    minOrderValue: null,
    maxOrderValue: null,
    currencyAllowlist: null,
    displayOrder: null,
    ...over,
  };
}

describe('mergeEffective — restrict-only invariant (5.4)', () => {
  it('AC1: a method the business has not unlocked never resolves, even if the store enabled it', () => {
    const result = mergeEffective(
      [catalog()],
      policyMap([{ methodId: 'zelle', status: 'pending_review', entityParams: {} }]),
      settingsMap([setting({ enabled: true })])
    );
    expect(result.find((m) => m.methodId === 'zelle')).toBeUndefined();
  });

  it('AC1: with no business policy row at all, the method never resolves', () => {
    const result = mergeEffective([catalog()], policyMap([]), settingsMap([setting({ enabled: true })]));
    expect(result).toHaveLength(0);
  });

  it('AC2: flipping the business to blocked drops an already store-enabled method', () => {
    const unlocked = mergeEffective(
      [catalog()],
      policyMap([{ methodId: 'zelle', status: 'unlocked', entityParams: {} }]),
      settingsMap([setting({ enabled: true })])
    );
    expect(unlocked.map((m) => m.methodId)).toContain('zelle');

    const blocked = mergeEffective(
      [catalog()],
      policyMap([{ methodId: 'zelle', status: 'blocked', entityParams: {} }]),
      settingsMap([setting({ enabled: true })])
    );
    expect(blocked.map((m) => m.methodId)).not.toContain('zelle');
  });

  it('AC3: force_disabled kill switch wins over unlocked + enabled', () => {
    const result = mergeEffective(
      [catalog({ forceDisabled: true })],
      policyMap([{ methodId: 'zelle', status: 'unlocked', entityParams: {} }]),
      settingsMap([setting({ enabled: true })])
    );
    expect(result).toHaveLength(0);
  });

  it('unpublished methods never resolve', () => {
    const result = mergeEffective(
      [catalog({ published: false })],
      policyMap([{ methodId: 'zelle', status: 'unlocked', entityParams: {} }]),
      settingsMap([setting({ enabled: true })])
    );
    expect(result).toHaveLength(0);
  });

  it('a fully-granted method resolves and is sorted by display/sort order', () => {
    const result = mergeEffective(
      [catalog({ methodId: 'card', displayName: 'Card', sortOrder: 20 }), catalog({ sortOrder: 90 })],
      policyMap([
        { methodId: 'card', status: 'unlocked', entityParams: {} },
        { methodId: 'zelle', status: 'unlocked', entityParams: {} },
      ]),
      settingsMap([setting({ methodId: 'card', enabled: true }), setting({ enabled: true })])
    );
    expect(result.map((m) => m.methodId)).toEqual(['card', 'zelle']);
  });

  it('restrict-only caps: store min/max is narrowed by entity bounds, never widened', () => {
    const [m] = mergeEffective(
      [catalog()],
      policyMap([{ methodId: 'zelle', status: 'unlocked', entityParams: { min_order_value: 5, max_order_value: 500 } }]),
      settingsMap([setting({ enabled: true, minOrderValue: 1, maxOrderValue: 1000 })])
    );
    // store asked for [1, 1000]; entity caps it to [5, 500].
    expect(m.minOrderValue).toBe(5);
    expect(m.maxOrderValue).toBe(500);
  });
});

// ── Cache + resolver against a stubbed supabase ──────────────────────────────
function makeSupabase(tables: Record<string, any[]>) {
  let fromCalls = 0;
  const client = {
    from(table: string) {
      fromCalls++;
      const rows = tables[table] || [];
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
    get fromCalls() {
      return fromCalls;
    },
  };
  return client as any;
}

describe('resolveEffectivePaymentMethods — cache (5.4 AC4)', () => {
  beforeEach(() => invalidateAll());

  const tables = {
    payment_method_catalog: [
      { method_id: 'card', display_name: 'Card', integration_type: 'stripe', published: true, force_disabled: false, default_config: {}, feature_flags: {}, sort_order: 20 },
    ],
    business_payment_policy: [{ method_id: 'card', status: 'unlocked', entity_params: {} }],
    merchant_payment_settings: [{ method_id: 'card', enabled: true, min_order_value: null, max_order_value: null, currency_allowlist: null, display_order: null }],
  };

  it('serves the second call from cache without re-querying', async () => {
    const supabase = makeSupabase(tables);
    const first = await resolveEffectivePaymentMethods(supabase, 'biz-1');
    expect(first.map((m) => m.methodId)).toEqual(['card']);
    const callsAfterFirst = supabase.fromCalls;

    await resolveEffectivePaymentMethods(supabase, 'biz-1');
    expect(supabase.fromCalls).toBe(callsAfterFirst); // no additional queries
  });

  it('invalidateBusiness forces a reload', async () => {
    const supabase = makeSupabase(tables);
    await resolveEffectivePaymentMethods(supabase, 'biz-1');
    const callsAfterFirst = supabase.fromCalls;
    invalidateBusiness('biz-1');
    await resolveEffectivePaymentMethods(supabase, 'biz-1');
    expect(supabase.fromCalls).toBeGreaterThan(callsAfterFirst);
  });
});

// ── Write-time restrict-only enforcement ─────────────────────────────────────
describe('setMerchantMethodSetting — write-time enforcement (5.4 AC1)', () => {
  it('rejects enabling a method the business has not unlocked', async () => {
    const supabase = {
      from() {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          single: () => Promise.resolve({ data: { status: 'pending_review' }, error: null }),
          upsert: () => Promise.resolve({ error: null }),
        };
        return builder;
      },
    } as any;

    const res = await setMerchantMethodSetting(supabase, 'biz-1', 'zelle', { enabled: true });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
  });

  it('allows enabling once the business has unlocked the method', async () => {
    const supabase = {
      from() {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          single: () => Promise.resolve({ data: { status: 'unlocked' }, error: null }),
          upsert: () => Promise.resolve({ error: null }),
        };
        return builder;
      },
    } as any;

    const res = await setMerchantMethodSetting(supabase, 'biz-1', 'zelle', { enabled: true });
    expect(res.ok).toBe(true);
  });
});
