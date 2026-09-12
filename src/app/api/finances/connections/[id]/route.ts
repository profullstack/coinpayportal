import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { deleteConnection, describeConnectionDeletion, getConnection } from '@/lib/finances/sync';
import { audit } from '@/lib/finances/audit';
import { isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/connections/[id] — the connection plus what deleting it
 * would take with it, so a client can show that list before asking.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Finance connection not found' }, { status: 404 });

  try {
    const connection = await getConnection(id, guard.id);
    if (!connection) return NextResponse.json({ error: 'Finance connection not found' }, { status: 404 });
    const affected = await describeConnectionDeletion(id, guard.id);
    return NextResponse.json({ connection, deletionWouldRemove: affected }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[finances/connections] read failed', err);
    return NextResponse.json({ error: 'Failed to read the connection' }, { status: 500 });
  }
}

/**
 * DELETE /api/finances/connections/[id] — remove the connection AND its
 * accounts, transactions, statements and reconciliation evidence.
 *
 * This is the destructive one; `POST …/disconnect` is the other. Because it
 * cascades, the client must first show what `GET` reports and then confirm
 * with `X-Confirm-Delete: yes` (or `?confirm=yes`). Without that the request
 * is refused with the list of what would go.
 *
 * The access URL is destroyed with the row and a SimpleFIN setup token
 * cannot be re-claimed, so re-linking means a fresh token at the bridge.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Finance connection not found' }, { status: 404 });

  try {
    const connection = await getConnection(id, guard.id);
    if (!connection) return NextResponse.json({ error: 'Finance connection not found' }, { status: 404 });

    const affected = await describeConnectionDeletion(id, guard.id);
    const confirmed =
      req.headers.get('x-confirm-delete')?.toLowerCase() === 'yes' ||
      req.nextUrl.searchParams.get('confirm') === 'yes';
    if (!confirmed) {
      return NextResponse.json(
        {
          error: 'Deleting this connection also deletes its account data. Confirm with X-Confirm-Delete: yes.',
          code: 'confirmation_required',
          deletionWouldRemove: affected,
        },
        { status: 409 },
      );
    }

    await deleteConnection(id, guard.id);
    await audit(guard.id, 'connection.delete', 'connection', id, {
      accounts: affected.accounts,
      transactions: affected.transactions,
      statements: affected.statements,
      reports: affected.reports,
    });
    return NextResponse.json({ success: true, removed: affected });
  } catch (err) {
    console.error('[finances/connections] delete failed', err);
    return NextResponse.json({ error: 'Failed to delete the connection' }, { status: 500 });
  }
}
