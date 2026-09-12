import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { disconnectConnection, getConnection } from '@/lib/finances/sync';
import { audit } from '@/lib/finances/audit';
import { isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/connections/[id]/disconnect — stop future syncs and
 * remove the usable credential. Accounts, transactions, reports and
 * statements all stay; nothing is deleted.
 *
 * For SimpleFIN this does not revoke anything at the bridge — an access URL
 * is disabled there by its owner. The response says so.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Finance connection not found' }, { status: 404 });

  try {
    const before = await getConnection(id, guard.id);
    if (!before) return NextResponse.json({ error: 'Finance connection not found' }, { status: 404 });
    await disconnectConnection(id, guard.id);
    const connection = await getConnection(id, guard.id);
    await audit(guard.id, 'connection.disconnect', 'connection', id, { provider: before.provider });
    return NextResponse.json({
      connection,
      note:
        before.provider === 'simplefin'
          ? 'The stored credential was removed and future syncs are cancelled. To revoke access at the provider as well, disable the access URL in your SimpleFIN bridge account.'
          : 'The stored credential was removed, the Plaid item was revoked, and future syncs are cancelled.',
    });
  } catch (err) {
    console.error('[finances/connections] disconnect failed', err);
    return NextResponse.json({ error: 'Failed to disconnect the connection' }, { status: 500 });
  }
}
