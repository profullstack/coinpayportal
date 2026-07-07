import { describe, it, expect, vi } from 'vitest';
import {
  hashApiKey,
  keyPrefix,
  normalizeScopes,
  scopesSatisfy,
  resolveScopedKey,
  createScopedApiKey,
  revokeScopedApiKey,
  WILDCARD_SCOPE,
} from './scoped-keys';

const VALID_KEY = 'cp_live_' + 'a'.repeat(32);

/** Minimal per-table query-builder mock. */
function builder(result: any) {
  const b: any = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    order: vi.fn(() => Promise.resolve(result)),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (onF: any, onR: any) => Promise.resolve(result).then(onF, onR),
  };
  return b;
}

function supabaseWith(tables: Record<string, any>) {
  return { from: vi.fn((t: string) => tables[t]) } as any;
}

describe('scoped-keys pure helpers', () => {
  it('hashApiKey is deterministic and not the raw key', () => {
    expect(hashApiKey(VALID_KEY)).toBe(hashApiKey(VALID_KEY));
    expect(hashApiKey(VALID_KEY)).not.toContain('cp_live_');
    expect(hashApiKey(VALID_KEY)).toHaveLength(64);
  });

  it('keyPrefix keeps a short displayable prefix', () => {
    expect(keyPrefix(VALID_KEY)).toBe('cp_live_aaaaaaaa');
  });

  it('normalizeScopes drops unknown scopes and de-dupes', () => {
    expect(normalizeScopes(['payments:create', 'bogus', 'payments:create'])).toEqual([
      'payments:create',
    ]);
    expect(normalizeScopes(undefined)).toEqual([]);
  });

  it('scopesSatisfy honors wildcard and exact match', () => {
    expect(scopesSatisfy([WILDCARD_SCOPE], 'payments:create')).toBe(true);
    expect(scopesSatisfy(['payments:create'], 'payments:create')).toBe(true);
    expect(scopesSatisfy(['payments:read'], 'payments:create')).toBe(false);
    expect(scopesSatisfy([], 'payments:create')).toBe(false);
  });
});

describe('resolveScopedKey', () => {
  it('returns business + scopes for a live scoped key', async () => {
    const supabase = supabaseWith({
      business_api_keys: builder({
        data: { id: 'k1', business_id: 'b1', scopes: ['payments:create'], revoked_at: null },
        error: null,
      }),
      businesses: builder({
        data: { id: 'b1', merchant_id: 'm1', name: 'github-bot', active: true },
        error: null,
      }),
    });
    const res = await resolveScopedKey(supabase, VALID_KEY);
    expect(res?.business.id).toBe('b1');
    expect(res?.scopes).toEqual(['payments:create']);
    expect(res?.keyId).toBe('k1');
  });

  it('returns null for a revoked key', async () => {
    const supabase = supabaseWith({
      business_api_keys: builder({
        data: { id: 'k1', business_id: 'b1', scopes: [], revoked_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    });
    expect(await resolveScopedKey(supabase, VALID_KEY)).toBeNull();
  });

  it('returns null when the key is not in the scoped table (legacy fallthrough)', async () => {
    const supabase = supabaseWith({
      business_api_keys: builder({ data: null, error: null }),
    });
    expect(await resolveScopedKey(supabase, VALID_KEY)).toBeNull();
  });

  it('returns null for a malformed key without hitting the db', async () => {
    const supabase = supabaseWith({});
    expect(await resolveScopedKey(supabase, 'not-a-key')).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns null when the owning business is inactive', async () => {
    const supabase = supabaseWith({
      business_api_keys: builder({
        data: { id: 'k1', business_id: 'b1', scopes: ['payments:create'], revoked_at: null },
        error: null,
      }),
      businesses: builder({
        data: { id: 'b1', merchant_id: 'm1', name: 'x', active: false },
        error: null,
      }),
    });
    expect(await resolveScopedKey(supabase, VALID_KEY)).toBeNull();
  });
});

describe('createScopedApiKey', () => {
  it('rejects an empty name', async () => {
    const res = await createScopedApiKey(supabaseWith({}), 'b1', {
      name: '  ',
      scopes: ['payments:create'],
    });
    expect(res.success).toBe(false);
  });

  it('rejects when no valid scope is provided', async () => {
    const res = await createScopedApiKey(supabaseWith({}), 'b1', {
      name: 'github-bot',
      scopes: ['bogus'],
    });
    expect(res.success).toBe(false);
  });

  it('mints a key and returns the raw value once', async () => {
    const supabase = supabaseWith({
      business_api_keys: builder({
        data: {
          id: 'k1',
          business_id: 'b1',
          prefix: 'cp_live_xxxx',
          name: 'github-bot',
          scopes: ['payments:create'],
          created_at: 'now',
          last_used_at: null,
          revoked_at: null,
        },
        error: null,
      }),
    });
    const res = await createScopedApiKey(supabase, 'b1', {
      name: 'github-bot',
      scopes: ['payments:create'],
      createdBy: 'm1',
    });
    expect(res.success).toBe(true);
    expect(res.apiKey).toMatch(/^cp_live_[a-f0-9]{32}$/);
    expect(res.record?.name).toBe('github-bot');
  });
});

describe('revokeScopedApiKey', () => {
  it('succeeds when a row was revoked', async () => {
    const supabase = supabaseWith({
      business_api_keys: builder({ data: { id: 'k1' }, error: null }),
    });
    expect((await revokeScopedApiKey(supabase, 'b1', 'k1')).success).toBe(true);
  });

  it('fails when nothing matched (already revoked/absent)', async () => {
    const supabase = supabaseWith({
      business_api_keys: builder({ data: null, error: null }),
    });
    expect((await revokeScopedApiKey(supabase, 'b1', 'k1')).success).toBe(false);
  });
});
