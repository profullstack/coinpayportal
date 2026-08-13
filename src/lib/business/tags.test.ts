import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyBusinessFilters, getBusinessTags, mutateBusinessTags } from './service';

/** Minimal PostgREST-ish chain recorder. */
function makeQuery() {
  const calls: { method: string; args: any[] }[] = [];
  const query: any = {};
  for (const method of ['or', 'contains', 'eq', 'in', 'select']) {
    query[method] = (...args: any[]) => {
      calls.push({ method, args });
      return query;
    };
  }
  query.__calls = calls;
  return query;
}

describe('applyBusinessFilters', () => {
  it('does nothing without filters', () => {
    const q = makeQuery();
    applyBusinessFilters(q, {});
    expect(q.__calls).toHaveLength(0);
  });

  it('searches name and description together', () => {
    const q = makeQuery();
    applyBusinessFilters(q, { search: 'stream' });
    expect(q.__calls[0].method).toBe('or');
    expect(q.__calls[0].args[0]).toBe('name.ilike.%stream%,description.ilike.%stream%');
  });

  it('strips characters that would break the or() grammar', () => {
    const q = makeQuery();
    applyBusinessFilters(q, { search: 'a,b(c)' });
    expect(q.__calls[0].args[0]).not.toMatch(/[(),].*ilike.*[(),]/);
    expect(q.__calls[0].args[0]).toContain('a b c');
  });

  it('narrows on every tag, normalized', () => {
    const q = makeQuery();
    applyBusinessFilters(q, { tags: ['#IPTV', 'Streaming'] });
    const contains = q.__calls.find((c: any) => c.method === 'contains');
    expect(contains.args).toEqual(['tags', ['iptv', 'streaming']]);
  });

  it('ignores empty tag lists', () => {
    const q = makeQuery();
    applyBusinessFilters(q, { tags: [] });
    expect(q.__calls.find((c: any) => c.method === 'contains')).toBeUndefined();
  });

  it('applies the facets', () => {
    const q = makeQuery();
    applyBusinessFilters(q, { category: 'saas', riskLevel: 'high', reviewStatus: 'pending' });
    const eqs = q.__calls.filter((c: any) => c.method === 'eq').map((c: any) => c.args);
    expect(eqs).toEqual([
      ['category', 'saas'],
      ['risk_level', 'high'],
      ['review_status', 'pending'],
    ]);
  });
});

describe('tag CRUD', () => {
  let current: any;
  let updated: any;
  let supabase: any;

  beforeEach(() => {
    current = {
      name: 'StreamBox',
      description: 'Subscriptions',
      category: 'saas',
      tags: ['streaming', 'vod'],
    };
    updated = null;

    supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
          })),
        })),
        update: vi.fn((columns: any) => {
          updated = columns;
          return {
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { tags: columns.tags }, error: null }),
              })),
            })),
          };
        }),
      })),
    };
  });

  it('reads the current tags', async () => {
    supabase.from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { tags: ['a', 'b'] }, error: null }),
        })),
      })),
    }));
    const result = await getBusinessTags(supabase, 'biz-1');
    expect(result.success).toBe(true);
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('adds without dropping what is there', async () => {
    const result = await mutateBusinessTags(supabase, 'biz-1', 'add', ['IPTV']);
    expect(result.success).toBe(true);
    expect(result.tags).toEqual(['streaming', 'vod', 'iptv']);
  });

  it('does not duplicate an existing tag', async () => {
    const result = await mutateBusinessTags(supabase, 'biz-1', 'add', ['#Streaming']);
    expect(result.tags).toEqual(['streaming', 'vod']);
  });

  it('removes a tag', async () => {
    const result = await mutateBusinessTags(supabase, 'biz-1', 'remove', ['vod']);
    expect(result.tags).toEqual(['streaming']);
  });

  it('replaces the whole set', async () => {
    const result = await mutateBusinessTags(supabase, 'biz-1', 'replace', ['iptv']);
    expect(result.tags).toEqual(['iptv']);
  });

  it('reclassifies on every write', async () => {
    const result = await mutateBusinessTags(supabase, 'biz-1', 'add', ['iptv']);
    expect(updated.risk_level).toBe('high');
    expect(updated.review_status).toBe('pending');
    expect(result.classification?.flags.map((f) => f.code)).toContain('piracy');
  });

  it('cannot shed a rating by dropping the tag when the name still carries it', async () => {
    current.name = 'IPTV Reseller Panel';
    const result = await mutateBusinessTags(supabase, 'biz-1', 'replace', []);
    expect(result.tags).toEqual([]);
    expect(updated.risk_level).toBe('high');
  });

  it('reports a missing business', async () => {
    supabase.from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    }));
    const result = await mutateBusinessTags(supabase, 'nope', 'add', ['x']);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Business not found');
  });
});
