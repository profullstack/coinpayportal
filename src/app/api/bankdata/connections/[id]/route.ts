import { NextRequest, NextResponse } from 'next/server';
import { guardBankDataRequest } from '@/lib/bankdata/guard';
import { BankDataError } from '@/lib/bankdata';
import { removeConnection } from '@/lib/bankdata/service';

/**
 * DELETE /api/bankdata/connections/[id]?business_id=…
 *
 * Disconnect an institution. Revokes the credential upstream before deleting local
 * rows, so a failure here never leaves a live token we can no longer reach.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    const guard = await guardBankDataRequest(
      request.headers.get('authorization'),
      businessId,
      'settings.manage',
    );
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }

    await removeConnection(guard.supabase, businessId as string, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof BankDataError) {
      const status = error.providerCode === 'NOT_FOUND' ? 404 : 502;
      return NextResponse.json({ success: false, error: error.message }, { status });
    }
    console.error('Error removing bank connection:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
