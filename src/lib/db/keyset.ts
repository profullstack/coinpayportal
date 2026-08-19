/**
 * Keyset pagination for background sweeps.
 *
 * The same defect appears across the cron workers: a `.limit(N)` with no
 * `.order()`. Postgres may return rows in any order it likes and in practice
 * returns a stable physical one, so once a table holds more than N matching
 * rows the sweep processes the same N on every run, forever, and the remainder
 * are never processed at all. Nothing errors and nothing is logged — the job
 * reports success having quietly ignored most of its work (B-03, F-1.3-09,
 * F-1.3-12, H-R-05).
 *
 * Ordering alone does not fix it. These sweeps select rows that stay selectable
 * until something moves them on — `status = 'sent'`, `status = 'funded'` — so
 * an ordered query returns the same first page every time just as reliably. The
 * page has to advance.
 *
 * Hence keyset rather than offset: `.range()` re-scans and skips, and rows
 * shifting underneath a long sweep make it drop or duplicate entries. A cursor
 * on a monotonic unique column is stable while the set changes.
 */

export interface KeysetPage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface KeysetResult<T> {
  rows: T[];
  /** True when `maxRows` was hit and the tail of the table was not visited. */
  truncated: boolean;
  /** Set when a page failed; `rows` then holds whatever was read before it. */
  error?: string;
}

/**
 * Walk every row matching a query, one page at a time.
 *
 * @param fetchPage - runs one page. Receives the last id of the previous page
 *   (`null` for the first) and the page size; must apply `.order('id')`,
 *   `.gt('id', cursor)` when a cursor is given, and `.limit(pageSize)`.
 * @param opts.pageSize - rows per round trip.
 * @param opts.maxRows - hard ceiling, a runaway guard rather than a working
 *   set. Reaching it sets `truncated`, which callers should log: a sweep that
 *   silently stops early is the bug this exists to prevent.
 */
export async function fetchAllKeyset<T extends { id: string }>(
  fetchPage: (cursor: string | null, pageSize: number) => Promise<KeysetPage<T>>,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<KeysetResult<T>> {
  const pageSize = opts.pageSize ?? 100;
  const maxRows = opts.maxRows ?? 5_000;

  const rows: T[] = [];
  let cursor: string | null = null;

  while (rows.length < maxRows) {
    const { data, error } = await fetchPage(cursor, pageSize);

    if (error) {
      // Return what was read rather than throwing it away: a sweep that
      // processed 300 of 400 rows has still done 300 rows of real work.
      return { rows, truncated: false, error: error.message };
    }
    if (!data || data.length === 0) break;

    rows.push(...data);
    cursor = data[data.length - 1].id;

    // A short page is the last page.
    if (data.length < pageSize) break;
  }

  return { rows, truncated: rows.length >= maxRows };
}
