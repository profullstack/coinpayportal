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

const MAX_FORWARD_RETRY_ATTEMPTS = 5;

function getNextRetryAt(attempts: number): string {
  const baseSeconds = 60; // 1m
  const delaySeconds = Math.min(baseSeconds * Math.pow(2, Math.max(0, attempts - 1)), 60 * 60); // cap at 1h
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function enqueueForwardingRetry(
  supabase: SupabaseClient,
  paymentId: string,
  error: string,
  attemptsOverride?: number
): Promise<void> {
  const attempts = attemptsOverride ?? 1;
  await supabase.from('payment_forwarding_queue').upsert({
    payment_id: paymentId,
    status: attempts >= MAX_FORWARD_RETRY_ATTEMPTS ? 'dead' : 'retrying',
    attempts,
    max_attempts: MAX_FORWARD_RETRY_ATTEMPTS,
    next_retry_at: getNextRetryAt(attempts),
    last_error: error,
    last_response: { error },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'payment_id' });
}

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

              // Immediate auto-retry once before queueing
              const retryResponse = await fetch(`${appUrl}/api/payments/${payment.id}/forward`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${internalApiKey}`,
                },
                body: JSON.stringify({ retry: true }),
              });

              if (!retryResponse.ok) {
                const retryErrorText = await retryResponse.text();
                console.error(`Immediate retry failed for ${payment.id}: ${retryResponse.status} - ${retryErrorText}`);
                await enqueueForwardingRetry(
                  supabase,
                  payment.id,
                  `initial=${forwardResponse.status}; retry=${retryResponse.status}; ${retryErrorText}`,
                  1
                );
              } else {
                console.log(`Forwarding retry succeeded for payment ${payment.id}`);
                await supabase.from('payment_forwarding_queue').delete().eq('payment_id', payment.id);
              }
            } else {
              console.log(`Forwarding triggered for payment ${payment.id}`);
              await supabase.from('payment_forwarding_queue').delete().eq('payment_id', payment.id);
            }
          } catch (forwardError) {
            const errMsg = forwardError instanceof Error ? forwardError.message : String(forwardError);
            console.error(`Error triggering forwarding for ${payment.id}:`, forwardError);
            await enqueueForwardingRetry(supabase, payment.id, errMsg, 1);
          }
        }
      }
    } catch (paymentError) {
      console.error(`Error processing payment ${payment.id}:`, paymentError);
      stats.errors++;
    }
  }

  // Process queued forwarding retries
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (internalApiKey) {
    const { data: queuedRetries, error: queueFetchError } = await supabase
      .from('payment_forwarding_queue')
      .select('payment_id, attempts, max_attempts, status')
      .in('status', ['pending', 'retrying'])
      .lte('next_retry_at', now.toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(25);

    if (queueFetchError) {
      console.error('Failed to fetch payment_forwarding_queue:', queueFetchError.message);
      stats.errors++;
    } else {
      for (const item of queuedRetries || []) {
        try {
          await supabase
            .from('payment_forwarding_queue')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('payment_id', item.payment_id);

          const retryResponse = await fetch(`${appUrl}/api/payments/${item.payment_id}/forward`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${internalApiKey}`,
            },
            body: JSON.stringify({ retry: true }),
          });

          if (retryResponse.ok) {
            await supabase
              .from('payment_forwarding_queue')
              .update({ status: 'resolved', updated_at: new Date().toISOString() })
              .eq('payment_id', item.payment_id);
            continue;
          }

          const errText = await retryResponse.text();
          const attempts = (item.attempts || 0) + 1;
          const isDead = attempts >= (item.max_attempts || MAX_FORWARD_RETRY_ATTEMPTS);

          await supabase
            .from('payment_forwarding_queue')
            .update({
              attempts,
              status: isDead ? 'dead' : 'retrying',
              next_retry_at: getNextRetryAt(attempts),
              last_error: errText.slice(0, 1000),
              last_response: { status: retryResponse.status, body: errText.slice(0, 4000) },
              updated_at: new Date().toISOString(),
            })
            .eq('payment_id', item.payment_id);

          if (isDead) {
            console.error(`Payment ${item.payment_id} forwarding retry exhausted, moved to dead queue`);
          }
        } catch (retryErr) {
          const attempts = (item.attempts || 0) + 1;
          const isDead = attempts >= (item.max_attempts || MAX_FORWARD_RETRY_ATTEMPTS);
          const errText = retryErr instanceof Error ? retryErr.message : String(retryErr);

          await supabase
            .from('payment_forwarding_queue')
            .update({
              attempts,
              status: isDead ? 'dead' : 'retrying',
              next_retry_at: getNextRetryAt(attempts),
              last_error: errText.slice(0, 1000),
              last_response: { error: errText.slice(0, 4000) },
              updated_at: new Date().toISOString(),
            })
            .eq('payment_id', item.payment_id);

          stats.errors++;
        }
      }
    }
  }

  return stats;
}
