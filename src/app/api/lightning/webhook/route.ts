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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      // Empty body or invalid JSON — treat as ping
      return NextResponse.json({ status: 'ok', message: 'Webhook is reachable' });
    }
    const offer_id = body.offer_id as string;
    const node_id = body.node_id as string;
    const business_id = body.business_id as string | undefined;
    const payment_hash = body.payment_hash as string;
    const preimage = body.preimage as string | undefined;
    const amount_msat = body.amount_msat as number;
    const payer_note = body.payer_note as string | undefined;

    // Handle test/ping requests
    if (body.test || body.ping) {
      return NextResponse.json({ status: 'ok', message: 'Webhook is reachable' });
    }

    if (!offer_id || !node_id || !payment_hash || !amount_msat) {
      return WalletErrors.badRequest(
        'VALIDATION_ERROR',
        'offer_id, node_id, payment_hash, and amount_msat are required'
      );
    }

    // Validate UUID format for IDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(String(node_id))) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'node_id must be a valid UUID');
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
