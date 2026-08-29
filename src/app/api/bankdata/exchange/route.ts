import { NextRequest, NextResponse } from 'next/server';
import { guardBankDataRequest } from '@/lib/bankdata/guard';
import { getBankDataProvider, BankDataError } from '@/lib/bankdata';
import { saveConnection } from '@/lib/bankdata/service';

/**
 * POST /api/bankdata/exchange
 *
 * Complete a link: swap the client's short-lived public token for durable credentials
 * and store them encrypted. The response deliberately contains no credential material.
 *
 * Body: { business_id: string, public_token: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const businessId = typeof body.business_id === 'string' ? body.business_id : null;
    const publicToken = typeof body.public_token === 'string' ? body.public_token : null;

    const guard = await guardBankDataRequest(
      request.headers.get('authorization'),
      businessId,
      'settings.manage',
    );
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }

    if (!publicToken) {
      return NextResponse.json(
        { success: false, error: 'public_token is required' },
        { status: 400 },
      );
    }

    const provider = getBankDataProvider();
    const exchange = await provider.exchangePublicToken(publicToken);
    const connection = await saveConnection(guard.supabase, {
      businessId: businessId as string,
      exchange,
    });

    return NextResponse.json({ success: true, connection });
  } catch (error) {
    if (error instanceof BankDataError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
    console.error('Error exchanging bank public token:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
