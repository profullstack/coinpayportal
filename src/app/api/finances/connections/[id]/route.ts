import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth/merchant-guard';
import { deleteConnection } from '@/lib/finances/sync';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/finances/connections/[id] — unlink an institution set.
 *
 * Cascades to its accounts and their transactions. Worth stating plainly: the
 * access URL is destroyed with the row and a SimpleFIN setup token cannot be
 * re-claimed, so re-linking means generating a fresh token at the bridge.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  try {
    await deleteConnection(id, guard.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[finances/connections] delete failed', err);
    return NextResponse.json({ error: 'Failed to delete the connection' }, { status: 500 });
  }
}
