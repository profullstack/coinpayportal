import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';

/**
 * GET /api/lightning/offers/:id
 * Get offer details + QR data.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const service = getGreenlightService();
    const offer = await service.getOffer(id);

    if (!offer) {
      return WalletErrors.notFound('offer');
    }

    return walletSuccess({
      offer,
      qr_uri: `lightning:${offer.bolt12_offer}`,
    });
  } catch (error) {
    console.error('[Lightning] GET /offers/:id error:', error);
    return WalletErrors.serverError();
  }
}
