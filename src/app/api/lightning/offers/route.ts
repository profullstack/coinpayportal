import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getLightningService } from '@/lib/lightning/lightning-service';


/**
 * POST /api/lightning/offers
 * Create a BOLT12 offer. Requires mnemonic for Signer.
 */
export async function POST(request: NextRequest) {
  // BOLT12 offers are managed via LNbits/CLN on the droplet.
  // This endpoint is no longer used for offer creation.
  return WalletErrors.badRequest('NOT_SUPPORTED', 'BOLT12 offer creation is managed via LNbits. Use the Lightning Address flow instead.');
}

/**
 * GET /api/lightning/offers
 * List offers for a business.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id') || undefined;
    const node_id = searchParams.get('node_id') || undefined;
    const wallet_id = searchParams.get('wallet_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const service = getLightningService();

    if (node_id && !wallet_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required when node_id is provided');
    }

    if (node_id && wallet_id) {
      const node = await service.getNode(node_id);
      if (!node) return WalletErrors.notFound('node');
      if (node.wallet_id !== wallet_id) {
        return WalletErrors.forbidden('Node does not belong to this wallet');
      }
    }

    const result = await service.listOffers({ business_id, node_id, status, limit, offset });

    return walletSuccess({
      offers: result.offers,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Lightning] GET /offers error:', error);
    return WalletErrors.serverError();
  }
}
