import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';
import { mnemonicToSeed, isValidMnemonic } from '@/lib/web-wallet/keys';

/**
 * POST /api/lightning/invoices
 * Create a BOLT11 invoice. Requires mnemonic for Signer.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { node_id, amount_sats, description, mnemonic } = body;

    if (!node_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'node_id is required');
    }
    if (!amount_sats || amount_sats <= 0) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'amount_sats is required and must be > 0');
    }
    if (!description) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'description is required');
    }
    if (!mnemonic || !isValidMnemonic(mnemonic)) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'Valid mnemonic is required for signing');
    }

    const seed = Buffer.from(mnemonicToSeed(mnemonic));
    const service = getGreenlightService();
    const invoice = await service.createInvoice({
      node_id,
      amount_sats,
      description,
      seed,
    });

    return walletSuccess({ invoice }, 201);
  } catch (error) {
    console.error('[Lightning] POST /invoices error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
}
