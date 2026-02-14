/**
 * Lightning Payment Monitor
 *
 * Checks active Greenlight nodes for new incoming BOLT12 payments.
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
  greenlight_node_id: string;
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

  // Skip if Greenlight is not configured
  if (!process.env.GL_NOBODY_CRT || !process.env.GL_NOBODY_KEY) {
    return stats;
  }

  // Fetch all active LN nodes
  const { data: activeNodes, error: fetchError } = await supabase
    .from('ln_nodes')
    .select('id, business_id, greenlight_node_id, node_pubkey, status, last_pay_index')
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

  // Lazy import to avoid loading Greenlight SDK when not configured
  const { GreenlightService } = await import('@/lib/lightning/greenlight');
  const glService = new GreenlightService();

  for (const node of activeNodes as LnNode[]) {
    stats.nodes_checked++;

    try {
      // Get invoices settled since last known pay_index
      const newPayments = await glService.getSettledPayments(
        node.greenlight_node_id,
        node.last_pay_index || 0
      );

      if (!newPayments || newPayments.length === 0) {
        continue;
      }

      stats.payments_found += newPayments.length;
      let maxPayIndex = node.last_pay_index || 0;

      for (const payment of newPayments) {
        try {
          // Check if we already recorded this payment
          const { data: existing } = await supabase
            .from('ln_payments')
            .select('id')
            .eq('payment_hash', payment.payment_hash)
            .single();

          if (existing) {
            // Already processed, just track pay_index
            if (payment.pay_index > maxPayIndex) {
              maxPayIndex = payment.pay_index;
            }
            continue;
          }

          // Find the matching offer if possible
          let offerId: string | null = null;
          if (payment.bolt12_offer) {
            const { data: offer } = await supabase
              .from('ln_offers')
              .select('id')
              .eq('bolt12_offer', payment.bolt12_offer)
              .eq('node_id', node.id)
              .single();
            offerId = offer?.id || null;
          }

          // Insert the new payment
          const { error: insertError } = await supabase
            .from('ln_payments')
            .insert({
              offer_id: offerId,
              node_id: node.id,
              business_id: node.business_id,
              payment_hash: payment.payment_hash,
              preimage: payment.preimage,
              amount_msat: payment.amount_msat,
              status: 'settled',
              payer_note: payment.payer_note || null,
              settled_at: payment.settled_at || now.toISOString(),
              created_at: now.toISOString(),
            });

          if (insertError) {
            console.error(`Failed to insert LN payment ${payment.payment_hash}:`, insertError);
            stats.errors++;
            continue;
          }

          stats.payments_settled++;

          // Fire webhook to merchant
          await sendLightningWebhook(supabase, {
            business_id: node.business_id,
            node_id: node.id,
            offer_id: offerId,
            payment_hash: payment.payment_hash,
            amount_msat: payment.amount_msat,
            settled_at: payment.settled_at || now.toISOString(),
          });

          console.log(
            `LN payment settled: ${payment.payment_hash} (${payment.amount_msat} msat) for node ${node.id}`
          );

          if (payment.pay_index > maxPayIndex) {
            maxPayIndex = payment.pay_index;
          }
        } catch (paymentError) {
          console.error(`Error processing LN payment ${payment.payment_hash}:`, paymentError);
          stats.errors++;
        }
      }

      // Update the node's last_pay_index watermark
      if (maxPayIndex > (node.last_pay_index || 0)) {
        await supabase
          .from('ln_nodes')
          .update({
            last_pay_index: maxPayIndex,
            updated_at: now.toISOString(),
          })
          .eq('id', node.id);
      }
    } catch (nodeError) {
      console.error(`Error monitoring LN node ${node.id}:`, nodeError);
      stats.errors++;
    }
  }

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
