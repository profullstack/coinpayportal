import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';
import { mnemonicToSeed, isValidMnemonic } from '@/lib/web-wallet/keys';

/**
 * POST /api/lightning/nodes
 * Provision a Greenlight CLN node for a wallet.
 * Derives LN node identity from the wallet's BIP39 seed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_id, business_id, mnemonic } = body;

    if (!wallet_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required');
    }
    if (!mnemonic || !isValidMnemonic(mnemonic)) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'Valid mnemonic is required');
    }

    const seed = Buffer.from(mnemonicToSeed(mnemonic));
    const service = getGreenlightService();

    const node = await service.provisionNode({
      wallet_id,
      business_id,
      seed,
    });

    return walletSuccess({ node }, 201);
  } catch (error) {
    console.error('[Lightning] POST /nodes error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
}
