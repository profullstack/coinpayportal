/**
 * Lightning Payment Monitor
 *
 * Checks active Lightning nodes for new incoming BOLT12 payments.
 * Uses CLN's listinvoices to find newly settled payments and updates
 * the ln_payments table + fires merchant webhooks.
 *
 * Integrated into the existing monitor-payments daemon — no separate cron needed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWebhook } from './webhook';

export interface LightningMonitorStats {
  nodes_checked: number;
  payments_found: number;
  payments_settled: number;
  errors: number;
}

interface LnNode {
  id: string;
  business_id: string;
  lnbits_wallet_id: string;
  node_pubkey: string;
  status: string;
  last_pay_index: number | null;
}

interface LnOffer {
  id: string;
  business_id: string;
  bolt12_offer: string;
  description: string;
}

/**
 * Monitor all active Lightning nodes for incoming payments
 */
export async function monitorLightningPayments(
  supabase: SupabaseClient,
  now: Date
): Promise<LightningMonitorStats> {
  const stats: LightningMonitorStats = {
    nodes_checked: 0,
    payments_found: 0,
    payments_settled: 0,
    errors: 0,
  };

  // Greenlight polling is deprecated. LNbits payment sync handles this now.
  // This function is kept for the syncLnbitsPayments call below.

  // Fetch all active LN nodes
  const { data: activeNodes, error: fetchError } = await supabase
    .from('ln_nodes')
    .select('id, business_id, lnbits_wallet_id, node_pubkey, status, last_pay_index')
    .eq('status', 'active')
    .limit(100);

  if (fetchError) {
    console.error('Failed to fetch active LN nodes:', fetchError);
    stats.errors++;
    return stats;
  }

  if (!activeNodes || activeNodes.length === 0) {
    return stats;
  }

  console.log(`Lightning monitor: checking ${activeNodes.length} active nodes`);

  // Greenlight node polling removed — using LNbits sync only.


  return stats;
}

/**
 * Send webhook notification for a settled Lightning payment
 */
async function sendLightningWebhook(
  supabase: SupabaseClient,
  payment: {
    business_id: string;
    node_id: string;
    offer_id: string | null;
    payment_hash: string;
    amount_msat: number;
    settled_at: string;
  }
): Promise<void> {
  try {
    // Get the business webhook URL
    const { data: business } = await supabase
      .from('businesses')
      .select('webhook_url, webhook_secret')
      .eq('id', payment.business_id)
      .single();

    if (!business?.webhook_url) {
      return;
    }

    // Use existing webhook infrastructure
    await sendWebhook(
      supabase,
      {
        id: payment.payment_hash,
        business_id: payment.business_id,
        blockchain: 'lightning',
        crypto_amount: payment.amount_msat / 1000, // convert msat to sats
        status: 'settled',
        payment_address: payment.node_id,
        created_at: payment.settled_at,
        expires_at: payment.settled_at,
        merchant_wallet_address: '',
      },
      'lightning.payment.settled',
      {
        payment_hash: payment.payment_hash,
        amount_msat: payment.amount_msat,
        amount_sats: Math.floor(payment.amount_msat / 1000),
        offer_id: payment.offer_id,
        settled_at: payment.settled_at,
      }
    );
  } catch (error) {
    console.error(`Failed to send LN webhook for ${payment.payment_hash}:`, error);
  }
}


/**
 * Sync LNbits payments to ln_payments table.
 * Runs as part of the cron monitor for wallets that have LNbits keys.
 * This ensures payments are persisted even even without the bridge.
 */
export async function syncLnbitsPayments(
  supabase: SupabaseClient,
  now: Date
): Promise<{ synced: number; errors: number }> {
  const stats = { synced: 0, errors: 0 };

  try {
    // Find wallets with LNbits keys
    const { data: wallets, error: wErr } = await supabase
      .from('wallets')
      .select('id, ln_wallet_inkey, ln_wallet_adminkey')
      .or('ln_wallet_inkey.not.is.null,ln_wallet_adminkey.not.is.null')
      .limit(100);

    if (wErr || !wallets?.length) return stats;

    // Lazy import LNbits
    const { listPayments } = await import('@/lib/lightning/lnbits');

    for (const wallet of wallets) {
      const apiKey = wallet.ln_wallet_inkey || wallet.ln_wallet_adminkey;
      if (!apiKey) continue;

      // Find the ln_node for this wallet
      const { data: node } = await supabase
        .from('ln_nodes')
        .select('id')
        .eq('wallet_id', wallet.id)
        .limit(1)
        .single();

      if (!node) continue;

      try {
        const payments = await listPayments(apiKey, 100);
        if (!payments?.length) continue;

        for (const p of payments as any[]) {
          // Only sync successful/completed payments
          if (p.status !== 'success' || p.pending) continue;

          const rawAmount = Number(p.amount || 0);
          const direction = rawAmount < 0 ? 'outgoing' : 'incoming';

          // Check if already exists
          const { data: existing } = await supabase
            .from('ln_payments')
            .select('id')
            .eq('payment_hash', p.payment_hash)
            .maybeSingle();

          if (existing) continue;

          let createdAt: string;
          if (p.created_at) {
            createdAt = new Date(p.created_at).toISOString();
          } else if (p.time && !isNaN(Number(p.time))) {
            createdAt = new Date(Number(p.time) * 1000).toISOString();
          } else if (p.time) {
            createdAt = new Date(p.time).toISOString();
          } else {
            createdAt = now.toISOString();
          }

          // Detect rebalance payments by checking for matching opposite-direction
          // payment with the same amount in a 5-minute window
          const amountMsat = Math.abs(rawAmount);
          const memo = (p.memo || p.extra?.comment || '') as string;
          const isRebalanceMemo = /rebalanc|circular|loop|autoloop/i.test(memo);

          let paymentType: 'payment' | 'rebalance' | 'internal' = 'payment';
          if (isRebalanceMemo) {
            paymentType = 'rebalance';
          } else {
            // Check if there's a matching opposite-direction payment (self-pay)
            const oppositeDir = direction === 'incoming' ? 'outgoing' : 'incoming';
            const { data: match } = await supabase
              .from('ln_payments')
              .select('id')
              .eq('node_id', node.id)
              .eq('direction', oppositeDir)
              .eq('amount_msat', amountMsat)
              .gte('created_at', new Date(new Date(createdAt).getTime() - 300_000).toISOString())
              .lte('created_at', new Date(new Date(createdAt).getTime() + 300_000).toISOString())
              .limit(1)
              .maybeSingle();

            if (match) {
              paymentType = 'rebalance';
              // Also mark the matching payment as rebalance
              await supabase
                .from('ln_payments')
                .update({ payment_type: 'rebalance' })
                .eq('id', match.id);
            }
          }

          const { error: insertErr } = await supabase
            .from('ln_payments')
            .insert({
              node_id: node.id,
              direction,
              payment_hash: p.payment_hash,
              preimage: p.preimage || null,
              amount_msat: amountMsat,
              status: 'settled',
              payment_type: paymentType,
              payer_note: memo || null,
              settled_at: p.updated_at || createdAt,
              created_at: createdAt,
            });

          if (insertErr) {
            console.warn(`[LNbits Sync] Failed to insert ${p.payment_hash}: ${insertErr.message}`);
            stats.errors++;
          } else {
            stats.synced++;
            console.log(`[LNbits Sync] Synced payment ${p.payment_hash} (${Math.abs(rawAmount)} msat, ${direction})`);
          }
        }
      } catch (walletErr) {
        console.warn(`[LNbits Sync] Failed for wallet ${wallet.id}:`, walletErr);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('[LNbits Sync] Fatal error:', err);
    stats.errors++;
  }

  return stats;
}
