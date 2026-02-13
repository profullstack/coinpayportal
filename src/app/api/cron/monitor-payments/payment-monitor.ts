/**
 * Payment Monitor
 *
 * Checks pending payments for blockchain deposits and expiration.
 * Triggers forwarding for confirmed payments.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { checkBalance } from './balance-checkers';
import { sendWebhook } from './webhook';
import type { Payment, MonitorStats } from './types';

/**
 * Monitor all pending payments
 */
export async function monitorPayments(
  supabase: SupabaseClient,
  now: Date
): Promise<MonitorStats> {
  const stats: MonitorStats = { checked: 0, confirmed: 0, expired: 0, errors: 0 };

  const { data: pendingPayments, error: fetchError } = await supabase
    .from('payments')
    .select(`
      id,
      business_id,
      blockchain,
      crypto_amount,
      status,
      payment_address,
      created_at,
      expires_at,
      merchant_wallet_address
    `)
    .eq('status', 'pending')
    .limit(100);

  if (fetchError) {
    console.error('Failed to fetch pending payments:', fetchError);
    throw new Error(fetchError.message);
  }

  console.log(`Processing ${pendingPayments?.length || 0} pending payments`);

  for (const payment of pendingPayments || []) {
    stats.checked++;

    try {
      // Check if payment has expired (15 minutes)
      const expiresAt = new Date(payment.expires_at);
      if (now > expiresAt) {
        await supabase
          .from('payments')
          .update({
            status: 'expired',
            updated_at: now.toISOString(),
          })
          .eq('id', payment.id);

        await sendWebhook(supabase, { ...payment, status: 'expired' } as Payment, 'payment.expired', {
          reason: 'Payment window expired (15 minutes)',
          expired_at: now.toISOString(),
        });

        stats.expired++;
        console.log(`Payment ${payment.id} expired`);
        continue;
      }

      // Check blockchain balance
      if (!payment.payment_address) {
        console.log(`Payment ${payment.id} has no payment address`);
        continue;
      }

      const balance = await checkBalance(payment.payment_address, payment.blockchain);
      console.log(`Payment ${payment.id}: balance=${balance}, expected=${payment.crypto_amount}`);

      // Check if sufficient funds received (allow 1% tolerance)
      const tolerance = payment.crypto_amount * 0.01;
      if (balance >= payment.crypto_amount - tolerance) {
        await supabase
          .from('payments')
          .update({
            status: 'confirmed',
            updated_at: now.toISOString(),
          })
          .eq('id', payment.id);

        await sendWebhook(supabase, { ...payment, status: 'confirmed' } as Payment, 'payment.confirmed', {
          received_amount: balance,
          confirmed_at: now.toISOString(),
        });

        stats.confirmed++;
        console.log(`Payment ${payment.id} confirmed with balance ${balance}`);

        // Skip forwarding for escrow-held addresses
        const { data: addrCheck } = await supabase
          .from('payment_addresses')
          .select('is_escrow')
          .eq('address', payment.payment_address)
          .single();

        if (addrCheck?.is_escrow) {
          console.log(`Payment ${payment.id} is escrow-held — skipping auto-forward`);
          continue;
        }

        // Trigger forwarding
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
        const internalApiKey = process.env.INTERNAL_API_KEY;

        if (internalApiKey) {
          try {
            const forwardResponse = await fetch(`${appUrl}/api/payments/${payment.id}/forward`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${internalApiKey}`,
              },
            });

            if (!forwardResponse.ok) {
              const errorText = await forwardResponse.text();
              console.error(`Failed to trigger forwarding for ${payment.id}: ${forwardResponse.status} - ${errorText}`);
            } else {
              console.log(`Forwarding triggered for payment ${payment.id}`);
            }
          } catch (forwardError) {
            console.error(`Error triggering forwarding for ${payment.id}:`, forwardError);
          }
        }
      }
    } catch (paymentError) {
      console.error(`Error processing payment ${payment.id}:`, paymentError);
      stats.errors++;
    }
  }

  return stats;
}
