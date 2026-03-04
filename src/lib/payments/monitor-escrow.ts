/**
 * Escrow Monitoring & Recurring Series
 */

import { checkBalance, processPayment, type Payment } from './monitor-balance';

// Escrow Monitoring
// ────────────────────────────────────────────────────────────

interface EscrowStats {
  checked: number;
  funded: number;
  expired: number;
  settled: number;
  errors: number;
}

interface Escrow {
  id: string;
  escrow_address: string;
  escrow_address_id?: string;
  chain: string;
  amount: number;
  deposited_amount?: number;
  fee_amount?: number;
  status: string;
  expires_at: string;
  beneficiary_address?: string;
  depositor_address?: string;
  business_id?: string;
}

/**
 * Process escrow monitoring cycle
 */
export async function runEscrowCycle(supabase: any, now: Date): Promise<EscrowStats> {
  const stats = { checked: 0, funded: 0, expired: 0, settled: 0, errors: 0 };
  
  try {
    // ── 1. Check pending escrows for deposits ──
    const { data: pendingEscrows, error: escrowFetchError } = await supabase
      .from('escrows')
      .select('id, escrow_address, chain, amount, status, expires_at')
      .eq('status', 'pending')
      .limit(50);

    if (!escrowFetchError && pendingEscrows && pendingEscrows.length > 0) {
      console.log(`[Monitor] Processing ${pendingEscrows.length} pending escrows`);

      for (const escrow of pendingEscrows) {
        stats.checked++;
        try {
          // Check if expired
          if (new Date(escrow.expires_at) < now) {
            await supabase
              .from('escrows')
              .update({ status: 'expired' })
              .eq('id', escrow.id)
              .eq('status', 'pending');
            await supabase.from('escrow_events').insert({
              escrow_id: escrow.id,
              event_type: 'expired',
              actor: 'system',
              details: {},
            });
            stats.expired++;
            console.log(`[Monitor] Escrow ${escrow.id} expired`);
            continue;
          }

          // Check balance on-chain using existing checkBalance function
          const balanceResult = await checkBalance(escrow.escrow_address, escrow.chain);
          const balance = balanceResult.balance;
          const tolerance = escrow.amount * 0.01;

          if (balance >= escrow.amount - tolerance) {
            // Mark as funded
            await supabase
              .from('escrows')
              .update({
                status: 'funded',
                funded_at: now.toISOString(),
                deposited_amount: balance,
              })
              .eq('id', escrow.id)
              .eq('status', 'pending');
            await supabase.from('escrow_events').insert({
              escrow_id: escrow.id,
              event_type: 'funded',
              actor: 'system',
              details: { deposited_amount: balance },
            });
            stats.funded++;
            console.log(`[Monitor] Escrow ${escrow.id} funded with ${balance}`);
          }
        } catch (escrowError) {
          console.error(`[Monitor] Error processing escrow ${escrow.id}:`, escrowError);
          stats.errors++;
        }
      }
    }

    // ── 1b. Check funded escrows for expiration (auto-refund) ──
    const { data: fundedEscrows } = await supabase
      .from('escrows')
      .select('id, escrow_address, escrow_address_id, chain, deposited_amount, depositor_address, beneficiary_address, amount, expires_at, allow_auto_release')
      .eq('status', 'funded')
      .lt('expires_at', now.toISOString())
      .limit(50);

    if (fundedEscrows && fundedEscrows.length > 0) {
      console.log(`[Monitor] Processing ${fundedEscrows.length} expired funded escrows (auto-release/auto-refund)`);
      for (const escrow of fundedEscrows) {
        try {
          if (escrow.allow_auto_release) {
            await supabase
              .from('escrows')
              .update({
                status: 'released',
                released_at: now.toISOString(),
              })
              .eq('id', escrow.id)
              .eq('status', 'funded');
            await supabase.from('escrow_events').insert({
              escrow_id: escrow.id,
              event_type: 'released',
              actor: 'system',
              details: {
                reason: 'Funded escrow expired with auto-release enabled',
                release_to: escrow.beneficiary_address,
                amount: escrow.deposited_amount || escrow.amount,
              },
            });
            stats.expired++;
            console.log(`[Monitor] Funded escrow ${escrow.id} expired — auto-released`);
            continue;
          }

          // Mark as refunded so step 3 picks it up for settlement
          await supabase
            .from('escrows')
            .update({ status: 'refunded' })
            .eq('id', escrow.id)
            .eq('status', 'funded');
          await supabase.from('escrow_events').insert({
            escrow_id: escrow.id,
            event_type: 'expired_refund',
            actor: 'system',
            details: { reason: 'Funded escrow expired without release' },
          });
          stats.expired++;
          console.log(`[Monitor] Funded escrow ${escrow.id} expired — marked for refund`);
        } catch (err) {
          console.error(`[Monitor] Error expiring funded escrow ${escrow.id}:`, err);
          stats.errors++;
        }
      }
    }

    // ── 2. Process released escrows (trigger settlement/forwarding) ──
    const { data: releasedEscrows } = await supabase
      .from('escrows')
      .select('id, escrow_address, escrow_address_id, chain, amount, deposited_amount, fee_amount, beneficiary_address, business_id')
      .eq('status', 'released')
      .limit(20);

    if (releasedEscrows && releasedEscrows.length > 0) {
      console.log(`[Monitor] Processing ${releasedEscrows.length} released escrows for settlement`);
      const settleStats = await processEscrowSettlement(releasedEscrows, 'release');
      stats.settled += settleStats.settled;
      stats.errors += settleStats.errors;
    }

    // ── 3. Process refunded escrows (return funds to depositor) ──
    const { data: refundedEscrows } = await supabase
      .from('escrows')
      .select('id, escrow_address, escrow_address_id, chain, deposited_amount, depositor_address')
      .eq('status', 'refunded')
      .is('settlement_tx_hash', null)
      .limit(20);

    if (refundedEscrows && refundedEscrows.length > 0) {
      console.log(`[Monitor] Processing ${refundedEscrows.length} refunded escrows`);
      const refundStats = await processEscrowSettlement(refundedEscrows, 'refund');
      stats.settled += refundStats.settled;
      stats.errors += refundStats.errors;
    }

    if (stats.checked > 0) {
      console.log(`[Monitor] Escrow cycle: checked=${stats.checked}, funded=${stats.funded}, expired=${stats.expired}, settled=${stats.settled}, errors=${stats.errors}`);
    }
  } catch (escrowMonitorError) {
    console.error('[Monitor] Escrow monitor error:', escrowMonitorError);
    stats.errors++;
  }
  
  return stats;
}

/**
 * Process escrow settlement via internal API calls
 */
async function processEscrowSettlement(escrows: Escrow[], action: 'release' | 'refund'): Promise<{ settled: number; errors: number }> {
  const stats = { settled: 0, errors: 0 };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    console.error('[Monitor] INTERNAL_API_KEY not configured - cannot process escrow settlements');
    stats.errors += escrows.length;
    return stats;
  }

  for (const escrow of escrows) {
    try {
      const body = action === 'refund' ? JSON.stringify({ action: 'refund' }) : undefined;
      const settleResponse = await fetch(`${appUrl}/api/escrow/${escrow.id}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${internalApiKey}`,
        },
        ...(body && { body }),
      });

      if (settleResponse.ok) {
        console.log(`[Monitor] Settlement triggered for escrow ${escrow.id} (${action})`);
        stats.settled++;
      } else {
        const errorText = await settleResponse.text();
        console.error(`[Monitor] Settlement failed for escrow ${escrow.id}: ${settleResponse.status} - ${errorText}`);
        stats.errors++;
      }
    } catch (settleError) {
      console.error(`[Monitor] Error settling escrow ${escrow.id}:`, settleError);
      stats.errors++;
    }
  }

  return stats;
}

// ────────────────────────────────────────────────────────────
// Recurring Escrow Series
// ────────────────────────────────────────────────────────────

interface RecurringStats {
  processed: number;
  created: number;
  completed: number;
  errors: number;
}

function calculateNextChargeAt(current: Date, interval: string): Date {
  const next = new Date(current);
  switch (interval) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
}

export async function runRecurringEscrowCycle(supabase: any, now: Date): Promise<RecurringStats> {
  const stats: RecurringStats = { processed: 0, created: 0, completed: 0, errors: 0 };

  try {
    const { data: dueSeries, error: fetchError } = await supabase
      .from('escrow_series')
      .select('*')
      .eq('status', 'active')
      .lte('next_charge_at', now.toISOString())
      .limit(50);

    if (fetchError || !dueSeries || dueSeries.length === 0) {
      return stats;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const internalApiKey = process.env.INTERNAL_API_KEY;

    if (!internalApiKey) {
      console.error('[Monitor] INTERNAL_API_KEY not configured - cannot process recurring escrows');
      stats.errors += dueSeries.length;
      return stats;
    }

    console.log(`[Monitor] Processing ${dueSeries.length} due recurring escrow series`);

    for (const series of dueSeries) {
      stats.processed++;
      try {
        let childCreated = false;

        if (series.payment_method === 'crypto') {
          // Create crypto escrow via internal API
          const res = await fetch(`${appUrl}/api/escrow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${internalApiKey}`,
            },
            body: JSON.stringify({
              business_id: series.merchant_id,
              chain: series.coin,
              amount: series.amount,
              currency: series.currency,
              depositor_address: series.depositor_address,
              beneficiary_address: series.beneficiary_address,
              description: series.description,
              series_id: series.id,
            }),
          });

          if (res.ok) {
            const escrow = await res.json();
            // Link series_id
            await supabase
              .from('escrows')
              .update({ series_id: series.id })
              .eq('id', escrow.id);
            childCreated = true;
            console.log(`[Monitor] Created crypto escrow ${escrow.id} for series ${series.id}`);
          } else {
            const errText = await res.text();
            console.error(`[Monitor] Failed to create crypto escrow for series ${series.id}: ${errText}`);
            stats.errors++;
            continue;
          }
        } else if (series.payment_method === 'card') {
          // Create Stripe escrow via internal API
          const res = await fetch(`${appUrl}/api/stripe/payments/create`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${internalApiKey}`,
            },
            body: JSON.stringify({
              businessId: series.merchant_id,
              amount: Number(series.amount),
              currency: series.currency?.toLowerCase() || 'usd',
              description: series.description,
              mode: 'escrow',
              series_id: series.id,
            }),
          });

          if (res.ok) {
            childCreated = true;
            console.log(`[Monitor] Created card payment for series ${series.id}`);
          } else {
            const errText = await res.text();
            console.error(`[Monitor] Failed to create card escrow for series ${series.id}: ${errText}`);
            stats.errors++;
            continue;
          }
        }

        if (childCreated) {
          stats.created++;
          const newPeriodsCompleted = series.periods_completed + 1;
          const nextChargeAt = calculateNextChargeAt(now, series.interval);
          const isCompleted = series.max_periods && newPeriodsCompleted >= series.max_periods;

          await supabase
            .from('escrow_series')
            .update({
              periods_completed: newPeriodsCompleted,
              next_charge_at: nextChargeAt.toISOString(),
              status: isCompleted ? 'completed' : 'active',
              updated_at: now.toISOString(),
            })
            .eq('id', series.id);

          if (isCompleted) {
            stats.completed++;
            console.log(`[Monitor] Series ${series.id} completed (${newPeriodsCompleted}/${series.max_periods})`);
          }
        }
      } catch (seriesError) {
        console.error(`[Monitor] Error processing series ${series.id}:`, seriesError);
        stats.errors++;
      }
    }

    if (stats.processed > 0) {
      console.log(`[Monitor] Recurring cycle: processed=${stats.processed}, created=${stats.created}, completed=${stats.completed}, errors=${stats.errors}`);
    }
  } catch (error) {
    console.error('[Monitor] Recurring escrow monitor error:', error);
    stats.errors++;
  }

  return stats;
}

// ────────────────────────────────────────────────────────────
// Main Monitor Cycle
// ────────────────────────────────────────────────────────────

/**
 * Run one monitoring cycle — payments + wallet transactions + escrows
 */
async function runMonitorCycle(): Promise<{ checked: number; confirmed: number; expired: number; errors: number }> {
  const stats = { checked: 0, confirmed: 0, expired: 0, errors: 0 };

  if (isCycleInProgress) {
    console.log('[Monitor] Previous cycle still running, skipping');
    return stats;
  }
  isCycleInProgress = true;
  
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[Monitor] Supabase credentials not configured');
      return stats;
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    
    // ── 1. Payment gateway monitoring ──
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
      console.error('[Monitor] Failed to fetch pending payments:', fetchError);
    } else if (pendingPayments && pendingPayments.length > 0) {
      console.log(`[Monitor] Processing ${pendingPayments.length} pending payments`);
      
      for (const payment of pendingPayments) {
        stats.checked++;
        try {
          const result = await processPayment(supabase, payment as Payment);
          if (result.confirmed) stats.confirmed++;
          if (result.expired) stats.expired++;
        } catch (error) {
          console.error(`[Monitor] Error processing payment ${payment.id}:`, error);
          stats.errors++;
        }
      }
    }
    
    // ── 2. Web-wallet transaction finalization ──
    const walletStats = await runWalletTxCycle(supabase);
    stats.checked += walletStats.checked;
    stats.confirmed += walletStats.confirmed;
    stats.errors += walletStats.errors;
    
    // ── 3. Escrow monitoring ──
    const escrowStats = await runEscrowCycle(supabase, now);
    stats.checked += escrowStats.checked;
    stats.confirmed += escrowStats.funded + escrowStats.settled;
    stats.expired += escrowStats.expired;
    stats.errors += escrowStats.errors;
    
    // ── 4. Recurring escrow series ──
    const recurringStats = await runRecurringEscrowCycle(supabase, now);
    stats.checked += recurringStats.processed;
    stats.confirmed += recurringStats.created;
    stats.errors += recurringStats.errors;

    // ── 5. Invoice payment monitoring ──
    const invoiceStats = await runInvoiceMonitorCycle(supabase, now);
    stats.checked += invoiceStats.checked;
    stats.confirmed += invoiceStats.paid;
    stats.errors += invoiceStats.errors;

    // ── 6. Invoice recurring scheduler ──
    const invoiceSchedStats = await runInvoiceSchedulerCycle(supabase, now);
    stats.checked += invoiceSchedStats.processed;
    stats.confirmed += invoiceSchedStats.created;
    stats.errors += invoiceSchedStats.errors;

    if (stats.checked > 0) {
      console.log(`[Monitor] Cycle complete: checked=${stats.checked}, confirmed=${stats.confirmed}, expired=${stats.expired}, errors=${stats.errors}`);
    }
  } catch (error) {
    console.error('[Monitor] Error in monitor cycle:', error);
  } finally {
    isCycleInProgress = false;
  }
  
  return stats;
}


