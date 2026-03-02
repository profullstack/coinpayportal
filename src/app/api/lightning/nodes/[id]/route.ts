import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getLightningService } from '@/lib/lightning/lightning-service';

/**
 * GET /api/lightning/nodes/:id
 * Get node status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const service = getLightningService();
    const node = await service.getNode(id);

    if (!node) {
      return WalletErrors.notFound('node');
    }

    return walletSuccess({ node });
  } catch (error) {
    console.error('[Lightning] GET /nodes/:id error:', error);
    return WalletErrors.serverError();
  }
}
