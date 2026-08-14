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
import { processConfirmedBusinessCollectionPayment } from '@/lib/payments/business-collection';
import { handleSubscriptionPaymentConfirmed } from '@/lib/subscriptions/service';

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

async function enqueueBusinessCollectionForwardingRetry(
  supabase: SupabaseClient,
  paymentId: string,
  error: string,
  attemptsOverride?: number
): Promise<void> {
  const attempts = attemptsOverride ?? 1;
  await supabase.from('business_collection_forwarding_queue').upsert({
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

async function activateSubscriptionFromPayment(
  supabase: SupabaseClient,
  businessCollectionPaymentId: string
): Promise<void> {
  const activation = await handleSubscriptionPaymentConfirmed(supabase, businessCollectionPaymentId);
  if (!activation.success) {
    throw new Error(activation.error || 'Failed to activate subscription from payment');
  }
}

/**
 * Ask the forwarding endpoint to move a confirmed payment out to the merchant,
 * retrying once inline before handing off to the retry queue.
 */
async function triggerForwarding(supabase: SupabaseClient, paymentId: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!internalApiKey) return;

  const post = (retry: boolean) =>
    fetch(`${appUrl}/api/payments/${paymentId}/forward`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${internalApiKey}`,
      },
      ...(retry ? { body: JSON.stringify({ retry: true }) } : {}),
    });

  try {
    const forwardResponse = await post(false);

    if (forwardResponse.ok) {
      console.log(`Forwarding triggered for payment ${paymentId}`);
      await supabase.from('payment_forwarding_queue').delete().eq('payment_id', paymentId);
      return;
    }

    const errorText = await forwardResponse.text();
    console.error(`Failed to trigger forwarding for ${paymentId}: ${forwardResponse.status} - ${errorText}`);

    // Immediate auto-retry once before queueing
    const retryResponse = await post(true);
    if (retryResponse.ok) {
      console.log(`Forwarding retry succeeded for payment ${paymentId}`);
      await supabase.from('payment_forwarding_queue').delete().eq('payment_id', paymentId);
      return;
    }

    const retryErrorText = await retryResponse.text();
    console.error(`Immediate retry failed for ${paymentId}: ${retryResponse.status} - ${retryErrorText}`);
    await enqueueForwardingRetry(
      supabase,
      paymentId,
      `initial=${forwardResponse.status}; retry=${retryResponse.status}; ${retryErrorText}`,
      1
    );
  } catch (forwardError) {
    const errMsg = forwardError instanceof Error ? forwardError.message : String(forwardError);
    console.error(`Error triggering forwarding for ${paymentId}:`, forwardError);
    await enqueueForwardingRetry(supabase, paymentId, errMsg, 1);
  }
}

/**
 * Mark a funded payment confirmed and push it out to the merchant.
 *
 * Confirmation and forwarding belong together: a payment that is marked settled
 * without the forwarding leg being attempted is exactly how funds end up
 * stranded at an intermediary address while the customer, the merchant and the
 * invoice all believe the money has landed.
 */
export async function confirmAndForwardPayment(
  supabase: SupabaseClient,
  payment: Payment,
  balance: number,
  now: Date,
): Promise<void> {
  await supabase
    .from('payments')
    .update({
      status: 'confirmed',
      confirmed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', payment.id);

  await sendWebhook(supabase, { ...payment, status: 'confirmed' } as Payment, 'payment.confirmed', {
    received_amount: balance,
    confirmed_at: now.toISOString(),
  });

  console.log(`Payment ${payment.id} confirmed with balance ${balance}`);

  // Skip forwarding for escrow-held addresses
  const { data: addrCheck } = await supabase
    .from('payment_addresses')
    .select('is_escrow')
    .eq('address', payment.payment_address)
    .single();

  if (addrCheck?.is_escrow) {
    console.log(`Payment ${payment.id} is escrow-held — skipping auto-forward`);
    return;
  }

  await triggerForwarding(supabase, payment.id);
}

/**
 * Deposits that land after the payment window closed.
 *
 * The 15-minute window is a quote-validity window, not a promise that nothing
 * will ever arrive afterwards — customers routinely pay an invoice hours or
 * days later, and the deposit address stays spendable regardless. Because the
 * main loop only queries `status = 'pending'`, an expired row was previously
 * never looked at again: the funds arrived, the address kept them, and no job
 * existed that would ever notice. This pass re-checks recently-expired
 * addressed payments so a late deposit still reaches the merchant.
 *
 * Bounded deliberately — each check is a chain RPC call, so this walks the
 * most recently expired rows rather than the entire history.
 */
const LATE_DEPOSIT_LOOKBACK_DAYS = 30;
const LATE_DEPOSIT_SCAN_LIMIT = 50;

export async function rescanLateDeposits(
  supabase: SupabaseClient,
  now: Date,
  stats: MonitorStats,
): Promise<void> {
  const since = new Date(now.getTime() - LATE_DEPOSIT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const { data: expiredPayments, error } = await supabase
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
    .eq('status', 'expired')
    .not('payment_address', 'is', null)
    .neq('payment_address', '')
    .gte('expires_at', since.toISOString())
    .order('expires_at', { ascending: false })
    .limit(LATE_DEPOSIT_SCAN_LIMIT);

  if (error) {
    console.error('Failed to fetch expired payments for late-deposit rescan:', error.message);
    stats.errors++;
    return;
  }

  for (const payment of expiredPayments || []) {
    stats.checked++;
    try {
      const balance = await checkBalance(payment.payment_address, payment.blockchain);
      const tolerance = payment.crypto_amount * 0.01;
      if (balance < payment.crypto_amount - tolerance) continue;

      console.log(
        `Payment ${payment.id} was funded after its payment window (expired ${payment.expires_at}); processing instead of leaving it stranded`,
      );
      await confirmAndForwardPayment(supabase, payment as Payment, balance, now);
      stats.confirmed++;
    } catch (err) {
      console.error(`Error rescanning expired payment ${payment.id}:`, err);
      stats.errors++;
    }
  }
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
      const expiresAt = new Date(payment.expires_at);
      const isExpired = now > expiresAt;

      // Always check the chain before expiring an addressed payment. This
      // prevents late or briefly missed deposits from being marked expired
      // while funds are already sitting at the generated CoinPay address.
      if (!payment.payment_address) {
        if (isExpired) {
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
        } else {
          console.log(`Payment ${payment.id} has no payment address`);
        }
        continue;
      }

      const balance = await checkBalance(payment.payment_address, payment.blockchain);
      console.log(`Payment ${payment.id}: balance=${balance}, expected=${payment.crypto_amount}`);

      // Check if sufficient funds received (allow 1% tolerance)
      const tolerance = payment.crypto_amount * 0.01;
      if (balance >= payment.crypto_amount - tolerance) {
        if (isExpired) {
          console.log(`Payment ${payment.id} was funded near the end of its window; processing instead of expiring`);
        }
        await confirmAndForwardPayment(supabase, payment as Payment, balance, now);
        stats.confirmed++;
      } else if (isExpired) {
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
      }
    } catch (paymentError) {
      console.error(`Error processing payment ${payment.id}:`, paymentError);
      stats.errors++;
    }
  }

  // Expiring a payment closes the quote, not the address — money can still turn
  // up afterwards. Catch those before they strand.
  await rescanLateDeposits(supabase, now, stats);

  // Process pending business-collection payments (includes subscription checkouts)
  const { data: pendingBusinessCollectionPayments, error: pendingCollectionError } = await supabase
    .from('business_collection_payments')
    .select('id, merchant_id, blockchain, crypto_amount, status, payment_address, expires_at, metadata')
    .eq('status', 'pending')
    .limit(100);

  if (pendingCollectionError) {
    console.error('Failed to fetch pending business collection payments:', pendingCollectionError.message);
    stats.errors++;
  } else {
    for (const payment of pendingBusinessCollectionPayments || []) {
      try {
        const expiresAt = new Date(payment.expires_at);
        const isExpired = now > expiresAt;

        if (!payment.payment_address) {
          if (isExpired) {
            await supabase
              .from('business_collection_payments')
              .update({ status: 'expired', updated_at: now.toISOString() })
              .eq('id', payment.id);
          }
          continue;
        }

        const balance = await checkBalance(payment.payment_address, payment.blockchain);
        const tolerance = payment.crypto_amount * 0.01;
        if (balance < payment.crypto_amount - tolerance) {
          if (isExpired) {
            await supabase
              .from('business_collection_payments')
              .update({ status: 'expired', updated_at: now.toISOString() })
              .eq('id', payment.id);
          }
          continue;
        }

        if (isExpired) {
          console.log(`Business collection payment ${payment.id} was funded after its payment window; processing instead of expiring`);
        }

        await supabase
          .from('business_collection_payments')
          .update({ status: 'confirmed', confirmed_at: now.toISOString(), updated_at: now.toISOString() })
          .eq('id', payment.id);

        const metadata = (payment.metadata && typeof payment.metadata === 'object') ? payment.metadata as Record<string, any> : {};
        const isSubscriptionPayment = metadata.type === 'subscription_payment';

        // IMPORTANT: activate subscription on confirmation, independent of forwarding success.
        if (isSubscriptionPayment) {
          try {
            await activateSubscriptionFromPayment(supabase, payment.id);
          } catch (entitlementErr) {
            await supabase
              .from('business_collection_payments')
              .update({
                metadata: {
                  ...metadata,
                  subscription_activation_error: entitlementErr instanceof Error ? entitlementErr.message : String(entitlementErr),
                  subscription_activation_failed_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', payment.id);
            throw entitlementErr;
          }
        }

        // Forward with immediate retry, then queue if still failing
        const initialForward = await processConfirmedBusinessCollectionPayment(supabase, payment.id);
        if (!initialForward.success) {
          const retryForward = await processConfirmedBusinessCollectionPayment(supabase, payment.id);
          if (!retryForward.success) {
            await enqueueBusinessCollectionForwardingRetry(
              supabase,
              payment.id,
              `initial=${initialForward.error || 'unknown'}; retry=${retryForward.error || 'unknown'}`,
              1
            );
          } else {
            await supabase.from('business_collection_forwarding_queue').delete().eq('payment_id', payment.id);
          }
        } else {
          await supabase.from('business_collection_forwarding_queue').delete().eq('payment_id', payment.id);
        }
      } catch (collectionErr) {
        console.error('Error processing business collection payment:', collectionErr);
        stats.errors++;
      }
    }
  }

  // Reconcile confirmed/forwarding_failed subscription payments that never upgraded account
  const { data: subscriptionReconcileRows } = await supabase
    .from('business_collection_payments')
    .select('id, status, metadata')
    .in('status', ['confirmed', 'forwarding', 'forwarding_failed'])
    .limit(100);

  for (const row of subscriptionReconcileRows || []) {
    const metadata = (row.metadata && typeof row.metadata === 'object') ? row.metadata as Record<string, any> : {};
    if (metadata.type !== 'subscription_payment') continue;
    try {
      await activateSubscriptionFromPayment(supabase, row.id);
    } catch (err) {
      // Keep row in place for future retry cycles
      await supabase
        .from('business_collection_payments')
        .update({
          metadata: {
            ...metadata,
            subscription_activation_error: err instanceof Error ? err.message : String(err),
            subscription_activation_failed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
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

    // Process queued business-collection forwarding retries
    const { data: queuedCollectionRetries, error: collectionQueueFetchError } = await supabase
      .from('business_collection_forwarding_queue')
      .select('payment_id, attempts, max_attempts, status')
      .in('status', ['pending', 'retrying'])
      .lte('next_retry_at', now.toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(25);

    if (collectionQueueFetchError) {
      console.error('Failed to fetch business_collection_forwarding_queue:', collectionQueueFetchError.message);
      stats.errors++;
    } else {
      for (const item of queuedCollectionRetries || []) {
        try {
          await supabase
            .from('business_collection_forwarding_queue')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('payment_id', item.payment_id);

          const retryForward = await processConfirmedBusinessCollectionPayment(supabase, item.payment_id);
          if (retryForward.success) {
            await supabase
              .from('business_collection_forwarding_queue')
              .update({ status: 'resolved', updated_at: new Date().toISOString() })
              .eq('payment_id', item.payment_id);
            continue;
          }

          const attempts = (item.attempts || 0) + 1;
          const isDead = attempts >= (item.max_attempts || MAX_FORWARD_RETRY_ATTEMPTS);
          await supabase
            .from('business_collection_forwarding_queue')
            .update({
              attempts,
              status: isDead ? 'dead' : 'retrying',
              next_retry_at: getNextRetryAt(attempts),
              last_error: (retryForward.error || 'Unknown forwarding error').slice(0, 1000),
              last_response: { error: (retryForward.error || 'Unknown forwarding error').slice(0, 4000) },
              updated_at: new Date().toISOString(),
            })
            .eq('payment_id', item.payment_id);
        } catch (retryErr) {
          const attempts = (item.attempts || 0) + 1;
          const isDead = attempts >= (item.max_attempts || MAX_FORWARD_RETRY_ATTEMPTS);
          const errText = retryErr instanceof Error ? retryErr.message : String(retryErr);

          await supabase
            .from('business_collection_forwarding_queue')
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
