import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { walletSuccess, WalletErrors } from '@/lib/web-wallet/response';
import { getGreenlightService } from '@/lib/lightning/greenlight';
import { listPayments as listLnbitsPayments } from '@/lib/lightning/lnbits';
import { mnemonicToSeed, isValidMnemonic } from '@/lib/web-wallet/keys';

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

        const apiKey = (walletRow as any)?.ln_wallet_inkey;
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
                status: 'settled',
                payment_type: 'payment',
                payer_note: p.memo || null,
                settled_at: p.created_at || null,
                created_at: p.time ? new Date(p.time * 1000).toISOString() : p.created_at,
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
