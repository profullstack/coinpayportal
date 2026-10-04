import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getLightningService } from '@/lib/lightning/lightning-service';
import { parsePaginationParam } from '@/lib/api/pagination';
import { createServerClient } from '@/lib/supabase/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { verifyBusinessAccess } from '@/lib/wallets/supported-coins';

/**
 * Hard ceiling on how many offers one request can pull back.
 *
 * `limit` was parsed with a floor and no ceiling, so a single caller could ask
 * for the entire table in one response.
 */
const MAX_OFFERS_PER_PAGE = 100;


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
 *
 * This route had no authentication at all, `business_id` was optional, and
 * `limit` had no ceiling — so one anonymous request returned every merchant's
 * Lightning offers and the revenue received against them. A caller must now
 * authenticate, must name the business, and must be able to read it.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id') || undefined;
    const node_id = searchParams.get('node_id') || undefined;
    const wallet_id = searchParams.get('wallet_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const limit = parsePaginationParam(searchParams.get('limit'), 20, {
      min: 1,
      max: MAX_OFFERS_PER_PAGE,
    });
    const offset = parsePaginationParam(searchParams.get('offset'), 0);

    const supabase = await createServerClient();
    const auth = await authenticateRequest(supabase, request.headers.get('authorization'));
    if (!auth.success || !auth.context) {
      return WalletErrors.unauthorized(auth.error || 'Authentication required');
    }

    // `business_id` used to be optional, and omitting it listed every business
    // on the platform. It is the scope of the query, so it is required.
    if (!business_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'business_id is required');
    }

    // A business API key is already bound to one business; a merchant JWT has
    // to be checked against the business it asked for.
    if (auth.context.type === 'business') {
      if (auth.context.businessId !== business_id) {
        return WalletErrors.forbidden('This API key cannot read that business');
      }
    } else {
      const access = await verifyBusinessAccess(supabase, business_id, auth.context.merchantId);
      if (!access.ok) {
        return WalletErrors.forbidden(access.error || 'No access to this business');
      }
    }

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
