import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { setSyncConsent } from '@/lib/finances/sync';
import { audit } from '@/lib/finances/audit';
import { isUuid, readJsonBody } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/connections/[id]/consent — opt a connection into (or
 * out of) a once-daily background sync. Body: `{ dailySync: boolean }`.
 *
 * Separate from linking on purpose: creating a credential is not consent
 * to spend its request budget every day.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Finance connection not found' }, { status: 404 });

  const body = await readJsonBody<{ dailySync?: unknown }>(req);
  if (typeof body.dailySync !== 'boolean') {
    return NextResponse.json({ error: 'dailySync must be true or false' }, { status: 400 });
  }

  try {
    const connection = await setSyncConsent(id, guard.id, body.dailySync);
    await audit(guard.id, 'connection.consent', 'connection', id, { dailySync: body.dailySync });
    return NextResponse.json({ connection }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update consent';
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    console.error('[finances/connections] consent failed', err);
    return NextResponse.json({ error: 'Failed to update consent' }, { status: 500 });
  }
}
