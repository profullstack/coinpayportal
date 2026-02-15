import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';
import { mnemonicToSeed, isValidMnemonic } from '@/lib/web-wallet/keys';

/**
 * POST /api/lightning/offers
 * Create a BOLT12 offer. Requires mnemonic for Signer.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { node_id, business_id, description, amount_msat, currency, mnemonic } = body;

    if (!node_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'node_id is required');
    }
    if (!description) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'description is required');
    }
    if (!mnemonic || !isValidMnemonic(mnemonic)) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'Valid mnemonic is required for signing');
    }

    const seed = Buffer.from(mnemonicToSeed(mnemonic));
    const service = getGreenlightService();
    const offer = await service.createOffer({
      node_id,
      business_id,
      description,
      amount_msat,
      currency,
      seed,
    });

    return walletSuccess({ offer }, 201);
  } catch (error) {
    console.error('[Lightning] POST /offers error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
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
    const status = searchParams.get('status') || undefined;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const service = getGreenlightService();
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
