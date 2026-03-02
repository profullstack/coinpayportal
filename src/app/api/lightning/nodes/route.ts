import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { createUserWallet, waitForExtensions } from '@/lib/lightning/lnbits';
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
      .select('id, wallet_id, lnbits_wallet_id, node_pubkey, status, created_at')
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
 * Provision a Lightning wallet for a wallet.
 * Provision a Lightning wallet via LNbits.
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

    const supabase = getSupabase();

    // Check if node already exists for this wallet (idempotent)
    const { data: existing } = await supabase
      .from('ln_nodes')
      .select('*')
      .eq('wallet_id', wallet_id)
      .maybeSingle();

    if (existing) {
      return walletSuccess({ node: existing }, 200);
    }


    // Create an LNbits wallet on the droplet for this web wallet
    const { data: walletRow } = await supabase
      .from('wallets')
      .select('id, name')
      .eq('id', wallet_id)
      .single();

    const walletName = (walletRow as { name?: string } | null)?.name || wallet_id;
    const lnbitsWallet = await createUserWallet(walletName);

    console.log('[Lightning] Created LNbits wallet:', lnbitsWallet.id, 'for web wallet:', wallet_id);

    // Store LNbits keys on the wallet record
    await supabase
      .from('wallets')
      .update({
        ln_wallet_inkey: lnbitsWallet.inkey,
        ln_wallet_adminkey: lnbitsWallet.adminkey,
      })
      .eq('id', wallet_id);

    // Create ln_nodes record
    const { data: node, error } = await supabase
      .from('ln_nodes')
      .insert({
        wallet_id,
        business_id: business_id || null,
        lnbits_wallet_id: lnbitsWallet.id,
        node_pubkey: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      throw new Error('Failed to create node record: ' + error.message);
    }

    // Wait for lnurlp extension to be enabled by the droplet's auto-enable timer
    await waitForExtensions(lnbitsWallet.inkey);

    return walletSuccess({ node }, 201);
  } catch (error) {
    const msg = (error as Error).message || 'Unknown error';
    console.error('[Lightning] POST /nodes error:', msg);
    const safeMsg = msg.includes('not configured') ? msg
      : msg.includes('already exists') ? 'A Lightning node already exists for this wallet'
      : 'Lightning node provisioning failed: ' + msg;
    return WalletErrors.serverError(safeMsg);
  }
}
