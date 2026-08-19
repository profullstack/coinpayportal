import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { syncAllConnections, syncConnection, DEFAULT_SYNC_DAYS } from '@/lib/finances/sync';

export const dynamic = 'force-dynamic';

// Reading eight institutions is slow — the bridge waits on each of them.
export const maxDuration = 300;

/**
 * POST /api/finances/sync — pull fresh balances and transactions.
 *
 * Explicitly an action rather than something that happens on page load:
 * SimpleFIN allows roughly 24 requests per day across the whole connection, so
 * a sync on every render would exhaust the budget before lunch.
 *
 * Body: `{ days?: number, connectionId?: string }`. Omitting `connectionId`
 * syncs every active connection.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;

  let body: { days?: unknown; connectionId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is the common case: sync everything with the default window.
  }

  const parsedDays = Number.parseInt(String(body.days ?? ''), 10);
  const days = Number.isFinite(parsedDays) ? parsedDays : DEFAULT_SYNC_DAYS;

  try {
    const results =
      typeof body.connectionId === 'string' && body.connectionId
        ? [await syncConnection(body.connectionId, { days })]
        : await syncAllConnections({ days });

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No SimpleFIN connection is configured yet' },
        { status: 400 },
      );
    }

    const totals = results.reduce(
      (acc, r) => ({
        accounts: acc.accounts + r.accounts,
        transactionsSeen: acc.transactionsSeen + r.transactionsSeen,
        transactionsNew: acc.transactionsNew + r.transactionsNew,
      }),
      { accounts: 0, transactionsSeen: 0, transactionsNew: 0 },
    );

    return NextResponse.json({
      results,
      totals,
      // A partial sync is a success with holes in it, not a failure — say so
      // rather than letting a silently short result read as complete.
      status: results.some((r) => r.status === 'partial') ? 'partial' : 'ok',
    });
  } catch (err) {
    console.error('[finances/sync] failed', err);
    // The message is already credential-redacted by the sync layer, and it is
    // the only way an operator learns that a bank needs re-authenticating.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 502 },
    );
  }
}
