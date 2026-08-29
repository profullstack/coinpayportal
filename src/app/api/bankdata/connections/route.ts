import { NextRequest, NextResponse } from 'next/server';
import { guardBankDataRequest } from '@/lib/bankdata/guard';
import { BankDataError } from '@/lib/bankdata';
import { listConnections } from '@/lib/bankdata/service';

/**
 * GET /api/bankdata/connections?business_id=…
 *
 * List the institutions a business has linked, with sync health. Read-only, so any
 * team member who can see the business can see them.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    const guard = await guardBankDataRequest(
      request.headers.get('authorization'),
      businessId,
      'business.read',
    );
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }

    const connections = await listConnections(guard.supabase, businessId as string);
    return NextResponse.json({ success: true, connections });
  } catch (error) {
    if (error instanceof BankDataError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
    console.error('Error listing bank connections:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
