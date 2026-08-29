import { NextRequest, NextResponse } from 'next/server';
import { guardBankDataRequest } from '@/lib/bankdata/guard';
import { BankDataError } from '@/lib/bankdata';
import { syncConnection } from '@/lib/bankdata/service';

/**
 * POST /api/bankdata/sync
 *
 * Pull new transactions for one connection. Incremental — the stored cursor means this
 * is cheap to call repeatedly and never re-downloads history.
 *
 * Body: { business_id: string, connection_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const businessId = typeof body.business_id === 'string' ? body.business_id : null;
    const connectionId = typeof body.connection_id === 'string' ? body.connection_id : null;

    const guard = await guardBankDataRequest(
      request.headers.get('authorization'),
      businessId,
      'business.read',
    );
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }

    if (!connectionId) {
      return NextResponse.json(
        { success: false, error: 'connection_id is required' },
        { status: 400 },
      );
    }

    const summary = await syncConnection(guard.supabase, businessId as string, connectionId);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    if (error instanceof BankDataError) {
      const status = error.providerCode === 'NOT_FOUND' ? 404 : 502;
      // Tell the client when the fix is a re-link rather than a retry.
      return NextResponse.json(
        { success: false, error: error.message, requires_reauth: error.requiresReauth },
        { status },
      );
    }
    console.error('Error syncing bank connection:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
