import { decryptLnKey } from '@/lib/lightning/key-encryption';
import { NextRequest } from 'next/server';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { createInvoice as createLnbitsInvoice } from '@/lib/lightning/lnbits';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/lightning/invoices
 * Create a BOLT11 invoice via LNbits.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_id, amount_sats, description } = body;

    if (!wallet_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required');
    }
    if (!amount_sats || amount_sats <= 0) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'amount_sats is required and must be > 0');
    }
    if (!description) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'description is required');
    }

    const supabase = getSupabase();
    const { data: wallet } = await supabase
      .from('wallets')
      .select('ln_wallet_inkey, ln_wallet_adminkey')
      .eq('id', wallet_id)
      .single();

    const rawKey = wallet?.ln_wallet_inkey || wallet?.ln_wallet_adminkey || null;
    const apiKey = rawKey ? decryptLnKey(rawKey) : null;
    if (!apiKey) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'Lightning wallet not configured. Enable Lightning first.');
    }

    const lnbitsInvoice = await createLnbitsInvoice(apiKey, amount_sats, description);

    const invoice = {
      id: lnbitsInvoice.payment_hash,
      bolt11: lnbitsInvoice.payment_request,
      payment_hash: lnbitsInvoice.payment_hash,
      amount_sats,
      description,
      status: 'unpaid',
      created_at: new Date().toISOString(),
    };

    return walletSuccess({ invoice }, 201);
  } catch (error) {
    console.error('[Lightning] POST /invoices error:', error);
    return WalletErrors.serverError((error as Error).message);
  }
}
