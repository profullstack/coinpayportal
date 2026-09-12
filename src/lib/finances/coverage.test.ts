import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));

import { coverageFromWindows, summarizeCoverage } from './coverage';

const START = '2026-04-01T07:00:00.000Z';
const END = '2026-07-01T07:00:00.000Z';

function w(overrides: Partial<Parameters<typeof coverageFromWindows>[1][number]>) {
  return {
    account_id: 'acct-1',
    requested_start: START,
    requested_end: END,
    outcome: 'fetched',
    capped: false,
    rows_rejected: 0,
    warnings: [],
    ...overrides,
  };
}

describe('coverageFromWindows', () => {
  it('is unknown when nothing was ever fetched, even if rows exist', () => {
    const c = coverageFromWindows('acct-1', [], START, END);
    expect(c.coverage).toBe('unknown');
    expect(c.fraction).toBe(0);
    expect(c.gaps).toEqual([{ start: START, end: END }]);
  });

  it('is fetched when overlapping clean windows cover the whole interval', () => {
    const c = coverageFromWindows(
      'acct-1',
      [
        w({ requested_start: '2026-03-27T07:00:00.000Z', requested_end: '2026-05-01T07:00:00.000Z' }),
        w({ requested_start: '2026-04-26T07:00:00.000Z', requested_end: '2026-06-01T07:00:00.000Z' }),
        w({ requested_start: '2026-05-27T07:00:00.000Z', requested_end: '2026-07-01T07:00:00.000Z' }),
      ],
      START,
      END,
    );
    expect(c.coverage).toBe('available_window_fetched');
    expect(c.gaps).toEqual([]);
    expect(c.fraction).toBe(1);
  });

  it('reports the gap when a chunk is missing', () => {
    const c = coverageFromWindows(
      'acct-1',
      [
        w({ requested_start: '2026-03-27T07:00:00.000Z', requested_end: '2026-05-01T07:00:00.000Z' }),
        w({ requested_start: '2026-05-27T07:00:00.000Z', requested_end: '2026-07-01T07:00:00.000Z' }),
      ],
      START,
      END,
    );
    expect(c.coverage).toBe('partial');
    expect(c.gaps).toEqual([{ start: '2026-05-01T07:00:00.000Z', end: '2026-05-27T07:00:00.000Z' }]);
  });

  it('does not count a failed or capped window, and keeps the cap visible', () => {
    // HTTP 200 with the range cut short is not coverage of the range.
    const c = coverageFromWindows('acct-1', [w({ capped: true }), w({ outcome: 'partial', warnings: ['Bank needs reauth'] })], START, END);
    expect(c.coverage).toBe('unknown');
    expect(c.capped).toBe(true);
    expect(c.warnings).toEqual(['Bank needs reauth']);
  });

  it('ignores other accounts and windows outside the interval', () => {
    const c = coverageFromWindows(
      'acct-1',
      [
        w({ account_id: 'acct-2' }),
        w({ requested_start: '2025-01-01T00:00:00.000Z', requested_end: '2025-02-01T00:00:00.000Z' }),
      ],
      START,
      END,
    );
    expect(c.coverage).toBe('unknown');
  });

  it('sums rejected rows across windows', () => {
    const c = coverageFromWindows('acct-1', [w({ rows_rejected: 2 }), w({ rows_rejected: 3 })], START, END);
    expect(c.rowsRejected).toBe(5);
  });
});

describe('summarizeCoverage', () => {
  it('is only fetched when every account is', () => {
    const base = { fraction: 1, gaps: [], warnings: [], capped: false, rowsRejected: 0 };
    expect(summarizeCoverage([])).toBe('unknown');
    expect(
      summarizeCoverage([
        { accountId: 'a', coverage: 'available_window_fetched', ...base },
        { accountId: 'b', coverage: 'available_window_fetched', ...base },
      ]),
    ).toBe('available_window_fetched');
    expect(
      summarizeCoverage([
        { accountId: 'a', coverage: 'available_window_fetched', ...base },
        { accountId: 'b', coverage: 'unknown', ...base },
      ]),
    ).toBe('partial');
    expect(
      summarizeCoverage([
        { accountId: 'a', coverage: 'unknown', ...base },
        { accountId: 'b', coverage: 'unknown', ...base },
      ]),
    ).toBe('unknown');
  });
});
