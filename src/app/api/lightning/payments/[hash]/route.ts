import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';

/**
 * GET /api/lightning/payments/:hash
 * Get payment status by payment hash.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await params;
    const service = getGreenlightService();
    const payment = await service.getPaymentStatus(hash);

    if (!payment) {
      return WalletErrors.notFound('payment');
    }

    return walletSuccess({ payment });
  } catch (error) {
    console.error('[Lightning] GET /payments/:hash error:', error);
    return WalletErrors.serverError();
  }
}
