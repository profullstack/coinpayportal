import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';
import { mnemonicToSeed, isValidMnemonic } from '@/lib/web-wallet/keys';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * GET /api/lightning/nodes?wallet_id=...
 * Get the LN node for a wallet.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletId = searchParams.get('wallet_id');

    if (!walletId) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required');
    }

    const supabase = getSupabase();
    const { data: node, error } = await supabase
      .from('ln_nodes')
      .select('id, wallet_id, greenlight_node_id, node_pubkey, status, created_at')
      .eq('wallet_id', walletId)
      .maybeSingle();

    if (error) {
      console.error('[Lightning] GET /nodes error:', error);
      return WalletErrors.serverError(error.message);
    }

    if (!node) {
      return walletSuccess({ node: null });
    }

    return walletSuccess({ node });
  } catch (error) {
    console.error('[Lightning] GET /nodes error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
}

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
