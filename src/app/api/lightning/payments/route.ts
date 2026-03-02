import { decryptLnKey } from '@/lib/lightning/key-encryption';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getLightningService } from '@/lib/lightning/lightning-service';
import { listPayments as listLnbitsPayments, payInvoice } from '@/lib/lightning/lnbits';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

/**
 * POST /api/lightning/payments
 * Send a Lightning payment (pay a BOLT12 offer or BOLT11 invoice).
 * Requires mnemonic for Signer.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_id, bolt12, amount_sats } = body;

    if (!wallet_id) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'wallet_id is required');
    }
    if (!bolt12) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'bolt12 (invoice or lightning address) is required');
    }

    const supabase = getSupabase();
    const { data: walletRow } = await supabase
      .from('wallets')
      .select('ln_wallet_adminkey')
      .eq('id', wallet_id)
      .single();

    const adminKey = (walletRow as any)?.ln_wallet_adminkey
      ? decryptLnKey((walletRow as any).ln_wallet_adminkey)
      : null;

    if (!adminKey) {
      return WalletErrors.badRequest('VALIDATION_ERROR', 'Lightning wallet not configured. Enable Lightning first.');
    }

    let bolt11 = bolt12.trim();

    // If it looks like a lightning address (user@domain), resolve via LNURL
    if (bolt11.includes('@') && !bolt11.startsWith('ln')) {
      const [user, domain] = bolt11.split('@');
      const lnurlRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`);
      if (!lnurlRes.ok) {
        return WalletErrors.badRequest('VALIDATION_ERROR', `Could not resolve lightning address: ${bolt11}`);
      }
      const lnurlData = await lnurlRes.json();
      if (!lnurlData.callback) {
        return WalletErrors.badRequest('VALIDATION_ERROR', 'Invalid LNURL response from lightning address');
      }

      const sendAmountMsat = (amount_sats || 1) * 1000;
      const minSendable = lnurlData.minSendable || 1000;
      const maxSendable = lnurlData.maxSendable || 1000000000;

      if (sendAmountMsat < minSendable || sendAmountMsat > maxSendable) {
        return WalletErrors.badRequest(
          'VALIDATION_ERROR',
          `Amount must be between ${Math.ceil(minSendable / 1000)} and ${Math.floor(maxSendable / 1000)} sats`
        );
      }

      const sep = lnurlData.callback.includes('?') ? '&' : '?';
      const callbackRes = await fetch(`${lnurlData.callback}${sep}amount=${sendAmountMsat}`);
      if (!callbackRes.ok) {
        return WalletErrors.badRequest('VALIDATION_ERROR', 'Failed to get invoice from lightning address');
      }
      const callbackData = await callbackRes.json();
      if (!callbackData.pr) {
        return WalletErrors.badRequest('VALIDATION_ERROR', 'No invoice returned from lightning address');
      }
      bolt11 = callbackData.pr;
    }

    // Pay the bolt11 invoice via LNbits
    const result = await payInvoice(adminKey, bolt11);

    return walletSuccess({
      payment_hash: result.payment_hash,
      status: 'settled',
    }, 200);
  } catch (error) {
    console.error('[Lightning] POST /payments error:', error);
    const msg = (error as Error).message || 'Payment failed';
    return WalletErrors.serverError(msg);
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

    const service = getLightningService();

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
      wallet_id,
      offer_id,
      direction,
      status,
      limit,
      offset,
    });

    // Also fetch LNbits payments directly for immediate visibility
    // (ln_payments table may lag behind due to cron sync interval)
    let payments = result.payments;
    let total = result.total;

    if (wallet_id) {
      try {
        const supabase = getSupabase();
        const { data: walletRow } = await supabase
          .from('wallets')
          .select('ln_wallet_inkey')
          .eq('id', wallet_id)
          .single();

        const apiKey = (walletRow as any)?.ln_wallet_inkey ? decryptLnKey((walletRow as any).ln_wallet_inkey) : null;
        if (apiKey) {
          const lnbitsPayments = await listLnbitsPayments(apiKey, limit);
          const lnbitsMapped = (lnbitsPayments || [])
            .filter((p: any) => p.status === 'success' && !p.pending)
            .filter((p: any) => {
              const rawAmount = Number(p.amount || 0);
              const dir = rawAmount < 0 ? 'outgoing' : 'incoming';
              if (direction && dir !== direction) return false;
              return true;
            })
            .map((p: any) => {
              const rawAmountMsat = Number(p.amount || 0);
              return {
                id: 'lnbits_' + p.payment_hash,
                node_id: node_id || null,
                direction: rawAmountMsat < 0 ? 'outgoing' : 'incoming',
                payment_hash: p.payment_hash,
                preimage: p.preimage || null,
                amount_msat: Math.abs(rawAmountMsat),
                fee_msat: p.fee != null ? Math.abs(Number(p.fee)) : null,
                status: 'settled',
                payment_type: 'payment',
                payer_note: p.memo || null,
                settled_at: p.created_at || null,
                created_at: p.created_at || (p.time ? new Date(p.time).toISOString() : new Date().toISOString()),
              };
            });

          // Merge: LNbits payments first, then ln_payments, dedup by payment_hash
          const byHash = new Map();
          for (const p of [...lnbitsMapped, ...payments]) {
            if (!byHash.has(p.payment_hash)) {
              byHash.set(p.payment_hash, p);
            }
          }
          payments = Array.from(byHash.values())
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit);
          total = byHash.size;
        }
      } catch (lnbitsErr) {
        console.warn('[Lightning] LNbits payment merge failed:', lnbitsErr);
      }
    }

    return walletSuccess({
      payments,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Lightning] GET /payments error:', error);
    return WalletErrors.serverError();
  }
}
