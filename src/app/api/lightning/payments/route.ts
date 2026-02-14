import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';

/**
 * GET /api/lightning/payments
 * List LN payments.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id') || undefined;
    const node_id = searchParams.get('node_id') || undefined;
    const offer_id = searchParams.get('offer_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const service = getGreenlightService();
    const result = await service.listPayments({
      business_id,
      node_id,
      offer_id,
      status,
      limit,
      offset,
    });

    return walletSuccess({
      payments: result.payments,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Lightning] GET /payments error:', error);
    return WalletErrors.serverError();
  }
}
