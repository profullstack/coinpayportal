import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';
import { createInvoice as createLnbitsInvoice } from '@/lib/lightning/lnbits';
import { createClient } from '@supabase/supabase-js';
import { mnemonicToSeed, isValidMnemonic } from '@/lib/web-wallet/keys';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/lightning/invoices
 * Create a BOLT11 invoice. Requires mnemonic for Signer.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { node_id, wallet_id, amount_sats, description, mnemonic } = body;

    if (!node_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'node_id is required');
    }
    if (!wallet_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required');
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

    const node = await service.getNode(node_id);
    if (!node) {
      return WalletErrors.notFound('node');
    }
    if (node.wallet_id !== wallet_id) {
      return WalletErrors.forbidden('Node does not belong to this wallet');
    }

    let invoice;
    try {
      invoice = await service.createInvoice({
        node_id,
        amount_sats,
        description,
        seed,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const noPython = /no Python runtime found/i.test(msg);
      if (!noPython) throw error;

      // Fallback: create BOLT11 invoice via LNbits wallet key when
      // Greenlight bridge is unavailable in this runtime.
      const { data: wallet } = await supabase
        .from('wallets')
        .select('ln_wallet_inkey,ln_wallet_adminkey,ln_username')
        .eq('id', wallet_id)
        .single();

      const lnbitsInvoiceKey = wallet?.ln_wallet_inkey || wallet?.ln_wallet_adminkey || null;
      if (!lnbitsInvoiceKey) {
        throw new Error('Lightning bridge unavailable and LNbits wallet not configured. Claim a Lightning Address first.');
      }

      const lnbitsInvoice = await createLnbitsInvoice(lnbitsInvoiceKey, amount_sats, description);
      invoice = {
        id: lnbitsInvoice.payment_hash,
        bolt11: lnbitsInvoice.payment_request,
        payment_hash: lnbitsInvoice.payment_hash,
        amount_msat: amount_sats * 1000,
        amount_sats,
        description,
        status: 'unpaid',
        created_at: new Date().toISOString(),
        expires_at: null,
      };
    }

    return walletSuccess({ invoice }, 201);
  } catch (error) {
    console.error('[Lightning] POST /invoices error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
}
