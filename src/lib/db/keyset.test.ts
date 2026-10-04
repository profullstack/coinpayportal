import { describe, expect, it, vi } from 'vitest';
import { fetchAllKeyset } from './keyset';

/**
 * Regression tests for the `.limit(N)` with no `.order()` family
 * (B-03, F-1.3-09, F-1.3-12, H-R-05).
 *
 * Every one of those sweeps read a bounded page of a set that does not drain —
 * `status = 'sent'`, `status = 'funded'`, terminal escrow statuses — so past N
 * rows the same N were processed on every run and the remainder never at all.
 * Nothing errored and nothing was logged: the job reported success having
 * silently ignored most of its work.
 */

/** A fake table that answers keyset pages the way PostgREST would. */
function fakeTable(ids: string[], pageSize: number) {
  const rows = ids.map((id) => ({ id }));
  return vi.fn(async (cursor: string | null, size: number) => {
    const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
    return { data: rows.slice(start, start + Math.min(size, pageSize)), error: null };
  });
}

describe('fetchAllKeyset', () => {
  it('walks past the first page instead of re-reading it', async () => {
    // The finding in one assertion: 250 rows, 100 to a page. The old code saw
    // the first 100 and nothing else, forever.
    const ids = Array.from({ length: 250 }, (_, i) => `id-${String(i).padStart(4, '0')}`);
    const page = fakeTable(ids, 100);

    const result = await fetchAllKeyset<{ id: string }>(page, { pageSize: 100 });

    expect(result.rows).toHaveLength(250);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('advances the cursor to the last id of the previous page', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const page = fakeTable(ids, 2);

    await fetchAllKeyset<{ id: string }>(page, { pageSize: 2 });

    // First call has no cursor; each later one resumes after the previous page.
    expect(page.mock.calls.map((c) => c[0])).toEqual([null, 'b', 'd']);
  });

  it('stops on a short page without an extra round trip', async () => {
    const page = fakeTable(['a', 'b', 'c'], 100);
    await fetchAllKeyset<{ id: string }>(page, { pageSize: 100 });
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('handles an empty set', async () => {
    const page = fakeTable([], 100);
    const result = await fetchAllKeyset<{ id: string }>(page, { pageSize: 100 });
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('flags truncation when the ceiling is reached', async () => {
    // The ceiling is a runaway guard, not a working set — but a caller that
    // silently stops early is the very bug this replaces, so it must be
    // reported rather than inferred from a row count.
    const ids = Array.from({ length: 100 }, (_, i) => `id-${String(i).padStart(4, '0')}`);
    const page = fakeTable(ids, 10);

    const result = await fetchAllKeyset<{ id: string }>(page, { pageSize: 10, maxRows: 30 });

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(30);
  });

  it('returns the rows read before a failing page, and the error', async () => {
    // A sweep that processed 20 of 50 rows has still done 20 rows of real work;
    // throwing that away would turn a partial outage into a total one.
    let call = 0;
    const page = vi.fn(async (cursor: string | null) => {
      call++;
      if (call === 1) {
        return { data: [{ id: 'a' }, { id: 'b' }], error: null };
      }
      return { data: null, error: { message: 'connection reset' } };
    });

    const result = await fetchAllKeyset<{ id: string }>(page, { pageSize: 2 });

    expect(result.rows).toHaveLength(2);
    expect(result.error).toBe('connection reset');
    expect(result.truncated).toBe(false);
  });
});
