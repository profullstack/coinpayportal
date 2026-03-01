import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';
import { mnemonicToSeed, isValidMnemonic } from '@/lib/web-wallet/keys';

/**
 * POST /api/lightning/payments
 * Send a Lightning payment (pay a BOLT12 offer or BOLT11 invoice).
 * Requires mnemonic for Signer.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { node_id, wallet_id, amount_sats, mnemonic } = body;
    const bolt12 = body.bolt12 || body.bolt11;

    if (!node_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'node_id is required');
    }
    if (!wallet_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required');
    }
    if (!bolt12) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'bolt12 (offer or invoice) is required');
    }
    if (!mnemonic || !isValidMnemonic(mnemonic)) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'Valid mnemonic is required for signing');
    }

    const seed = Buffer.from(mnemonicToSeed(mnemonic));
    const service = getGreenlightService();

    const node = await service.getNode(node_id);
    if (!node) {
      return WalletErrors.notFound('node');
    }
    if (node.wallet_id !== wallet_id) {
      return WalletErrors.forbidden('Node does not belong to this wallet');
    }

    const result = await service.payOffer({ node_id, bolt12, amount_sats, seed });

    // Record the outgoing payment in DB
    if (node) {
      await service.recordPayment({
        offer_id: null,
        direction: 'outgoing',
        node_id,
        business_id: node.business_id || undefined,
        payment_hash: result.payment_hash,
        preimage: result.preimage,
        amount_msat: result.amount_msat,
      });
    }

    return walletSuccess({ payment: result });
  } catch (error) {
    console.error('[Lightning] POST /payments error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
}

/**
 * GET /api/lightning/payments
 * List LN payments.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id') || undefined;
    const node_id = searchParams.get('node_id') || undefined;
    const wallet_id = searchParams.get('wallet_id') || undefined;
    const offer_id = searchParams.get('offer_id') || undefined;
    const directionParam = searchParams.get('direction');
    const direction = directionParam === 'incoming' || directionParam === 'outgoing'
      ? directionParam
      : undefined;
    const status = searchParams.get('status') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const service = getGreenlightService();

    if (node_id && !wallet_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required when node_id is provided');
    }

    if (node_id && wallet_id) {
      const node = await service.getNode(node_id);
      if (!node) return WalletErrors.notFound('node');
      if (node.wallet_id !== wallet_id) {
        return WalletErrors.notFound('node');
      }
    }

    const result = await service.listPayments({
      business_id,
      node_id,
      offer_id,
      direction,
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
