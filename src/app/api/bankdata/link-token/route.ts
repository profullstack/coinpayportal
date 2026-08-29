import { NextRequest, NextResponse } from 'next/server';
import { guardBankDataRequest } from '@/lib/bankdata/guard';
import { getBankDataProvider, BankDataError } from '@/lib/bankdata';

/**
 * POST /api/bankdata/link-token
 *
 * Mint a short-lived token for the provider's client-side link UI. Linking an
 * institution is a settings-level action, so it needs admin+ rather than read access.
 *
 * Body: { business_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const businessId = typeof body.business_id === 'string' ? body.business_id : null;

    const guard = await guardBankDataRequest(
      request.headers.get('authorization'),
      businessId,
      'settings.manage',
    );
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }

    const provider = getBankDataProvider();
    const session = await provider.createLinkSession({
      // The merchant id is a stable, non-PII identifier, which is what the provider
      // wants here — never an email address.
      clientUserId: guard.userId,
      webhookUrl: process.env.BANKDATA_WEBHOOK_URL,
    });

    return NextResponse.json({ success: true, link_token: session.linkToken, expires_at: session.expiresAt });
  } catch (error) {
    if (error instanceof BankDataError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
    console.error('Error creating bank link token:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
