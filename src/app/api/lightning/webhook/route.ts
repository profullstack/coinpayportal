import { NextRequest, NextResponse } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';

/**
 * GET /api/lightning/webhook
 * Health check endpoint for webhook ping tests.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'lightning-webhook' });
}

/**
 * POST /api/lightning/webhook
 * Internal webhook for payment settlement.
 * Called by the settlement worker or Greenlight callback.
 */
export async function POST(request: NextRequest) {
  try {
    // No auth required — payload is validated below (offer_id, node_id, etc.)

    const body = await request.json();
    const {
      offer_id,
      node_id,
      business_id,
      payment_hash,
      preimage,
      amount_msat,
      payer_note,
    } = body;

    if (!offer_id || !node_id || !payment_hash || !amount_msat) {
      return WalletErrors.badRequest(
        'VALIDATION_ERROR',
        'offer_id, node_id, payment_hash, and amount_msat are required'
      );
    }

    const service = getGreenlightService();
    const payment = await service.recordPayment({
      offer_id,
      node_id,
      business_id,
      payment_hash,
      preimage,
      amount_msat,
      payer_note,
    });

    return walletSuccess({ payment }, 201);
  } catch (error) {
    console.error('[Lightning] POST /webhook error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
}
