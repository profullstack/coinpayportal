/**
 * Escrow Monitoring & Recurring Series
 */

import { checkBalance, processPayment, type Payment } from './monitor-balance';
import { isSufficientPayment } from './tolerance';
import { fetchAllKeyset } from '../db/keyset';
import { createEscrow } from '../escrow/service';

// ── Retry tracking (in-memory) ──
// Prevents infinite retry loops that leak memory and cause OOM crashes.
// Each failed ID gets exponential backoff; after MAX_RETRIES it's skipped
// until the process restarts (Railway restart clears the map).
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 60_000; // 1 min, then 2, 4, 8, 16 min
const retryState = new Map<string, { count: number; nextRetryAt: number; lastError: string }>();

function shouldRetry(id: string): boolean {
  const state = retryState.get(id);
  if (!state) return true;
  if (state.count >= MAX_RETRIES) return false;
  return Date.now() >= state.nextRetryAt;
}

function recordFailure(id: string, error: string): void {
  const state = retryState.get(id) || { count: 0, nextRetryAt: 0, lastError: '' };
  state.count++;
  state.lastError = error;
  state.nextRetryAt = Date.now() + BACKOFF_BASE_MS * Math.pow(2, state.count - 1);
  retryState.set(id, state);
  if (retryState.size > 500) {
    const oldest = retryState.keys().next().value;
    if (oldest) retryState.delete(oldest);
  }
}

function recordSuccess(id: string): void {
  retryState.delete(id);
}

// Errors that require manual intervention — don't retry
const PERMANENT_ERRORS = [
  'insufficient funds for rent',
  'insufficient lamports',
  'account not found',
];

function isPermanentError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return PERMANENT_ERRORS.some(e => lower.includes(e));
}

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
          // BL-02: check the balance BEFORE expiring, not instead of.
          //
          // This used to mark a pending escrow `expired` on the clock alone. If
          // the deposit had landed but no cycle had yet observed it — it arrived
          // between two runs, or in the last minutes before expiry — the escrow
          // went to `expired` holding real money, and every exit closed at once:
          // release wants `funded` or `disputed`, refund wants `funded`, dispute
          // wants `funded`, and the auto-release/auto-refund sweep below selects
          // only `funded`. Neither party could do anything and nothing would
          // ever settle it. The funds were simply gone.
          //
          // Reading the chain first means a deposit that arrived in time is
          // recognised as `funded`; the sweep below then auto-releases or
          // auto-refunds it on the next cycle, according to the escrow's own
          // setting. Only a genuinely empty escrow expires.
          const balanceResult = await checkBalance(escrow.escrow_address, escrow.chain);
          const balance = balanceResult.balance;

          if (new Date(escrow.expires_at) < now) {
            // An unreadable balance is not an empty one. Expiring on a failed
            // read is exactly the irreversible mistake this fix exists to stop,
            // so leave it pending and try again next cycle.
            if (balanceResult.error) {
              console.warn(
                `[Monitor] Escrow ${escrow.id} is past expiry but its balance could not be read (${balanceResult.error}); leaving pending`
              );
              stats.errors++;
              continue;
            }

            if (isSufficientPayment(balance, escrow.amount)) {
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
                details: {
                  reason: 'Deposit found at expiry — funded rather than expired so it can still settle',
                  deposited_amount: balance,
                },
              });
              stats.funded++;
              console.log(`[Monitor] Escrow ${escrow.id} was funded at expiry — marked funded, not expired`);
              continue;
            }

            await supabase
              .from('escrows')
              .update({ status: 'expired' })
              .eq('id', escrow.id)
              .eq('status', 'pending');
            await supabase.from('escrow_events').insert({
              escrow_id: escrow.id,
              event_type: 'expired',
              actor: 'system',
              details: { confirmed_empty: true, balance },
            });
            stats.expired++;
            console.log(`[Monitor] Escrow ${escrow.id} expired (confirmed empty)`);
            continue;
          }

          if (isSufficientPayment(balance, escrow.amount)) {
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
    // F-1.1-01: multisig escrows are excluded here.
    //
    // This sweep flips an expired funded escrow to `released` or `refunded` and
    // hands it to `processEscrowSettlement`, which moves funds using the key the
    // platform holds. A 2-of-3 multisig escrow has no such key: its funds can
    // only move through `proposeTransaction` or `disputeMultisigEscrow`, and
    // both require status `funded`. Marking one `refunded` therefore closed the
    // only two ways its money could ever move, while the settlement path it was
    // handed to cannot sign for it either — so the flag would sit on a
    // permanently unspendable escrow.
    //
    // Leaving them `funded` past expiry is correct: for a multisig the deadline
    // is the point at which the participants should act, not a licence for the
    // platform to act for them.
    const { data: fundedEscrows } = await supabase
      .from('escrows')
      .select('id, escrow_address, escrow_address_id, chain, deposited_amount, depositor_address, beneficiary_address, amount, expires_at, allow_auto_release, escrow_model')
      .eq('status', 'funded')
      .lt('expires_at', now.toISOString())
      .or('escrow_model.is.null,escrow_model.neq.multisig_2of3')
      .limit(50);

    if (fundedEscrows && fundedEscrows.length > 0) {
      console.log(`[Monitor] Processing ${fundedEscrows.length} expired funded escrows (auto-release/auto-refund)`);
      for (const escrow of fundedEscrows) {
        try {
          // Belt and braces on the query filter above: a multisig escrow that
          // reached this loop must not be transitioned, because doing so is
          // irreversible for funds the platform cannot sign for.
          if (escrow.escrow_model === 'multisig_2of3') {
            console.warn(
              `[Monitor] Skipping expired multisig escrow ${escrow.id} — its funds move only via propose/dispute, which require status 'funded'`
            );
            continue;
          }

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
    //
    // F-1.3-12: this was `.limit(20)` with no `.order()`. An escrow stays
    // `released` until it settles, so an escrow that can never settle — a dead
    // RPC, a chain with no gas, a bad address — holds its slot in that window
    // permanently. Twenty of them and the window is full: no newly-released
    // escrow is ever settled again, and the job reports success every run.
    //
    // The retry gate inside `processEscrowSettlement` already declines to
    // re-attempt an exhausted escrow, but a skipped escrow still occupied one
    // of the twenty slots, so the gate made the stall cheaper rather than
    // fixing it. Walking the set means a fresh escrow is always reached.
    const { rows: releasedEscrows, truncated: releasedTruncated } = await fetchAllKeyset<any>(
      (cursor, pageSize) => {
        let q = supabase
          .from('escrows')
          .select('id, escrow_address, escrow_address_id, chain, amount, deposited_amount, fee_amount, beneficiary_address, business_id')
          .eq('status', 'released')
          .order('id', { ascending: true })
          .limit(pageSize);
        if (cursor) q = q.gt('id', cursor);
        return q as unknown as Promise<{ data: any[] | null; error: { message: string } | null }>;
      },
      { pageSize: 20, maxRows: 500 }
    );

    if (releasedTruncated) {
      console.warn('[Monitor] Released-escrow settlement hit its row ceiling; the tail was not processed this run');
    }

    if (releasedEscrows && releasedEscrows.length > 0) {
      console.log(`[Monitor] Processing ${releasedEscrows.length} released escrows for settlement`);
      const settleStats = await processEscrowSettlement(releasedEscrows, 'release');
      stats.settled += settleStats.settled;
      stats.errors += settleStats.errors;
    }

    // ── 3. Process refunded escrows (return funds to depositor) ──
    //
    // Same window, same defect as section 2 above — a refund that cannot be
    // sent holds its slot and starves every later one.
    const { rows: refundedEscrows, truncated: refundedTruncated } = await fetchAllKeyset<any>(
      (cursor, pageSize) => {
        let q = supabase
          .from('escrows')
          .select('id, escrow_address, escrow_address_id, chain, deposited_amount, depositor_address')
          .eq('status', 'refunded')
          .is('settlement_tx_hash', null)
          .order('id', { ascending: true })
          .limit(pageSize);
        if (cursor) q = q.gt('id', cursor);
        return q as unknown as Promise<{ data: any[] | null; error: { message: string } | null }>;
      },
      { pageSize: 20, maxRows: 500 }
    );

    if (refundedTruncated) {
      console.warn('[Monitor] Refunded-escrow settlement hit its row ceiling; the tail was not processed this run');
    }

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
 * Now with retry tracking + exponential backoff to prevent OOM from infinite loops
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
    const retryKey = `settle:${escrow.id}`;

    if (!shouldRetry(retryKey)) {
      const state = retryState.get(retryKey);
      if (state && state.count === MAX_RETRIES) {
        console.warn(`[Monitor] Escrow ${escrow.id} settlement skipped — max retries exceeded (${state.lastError}). Needs manual intervention.`);
        state.count++; // stop re-logging
      }
      continue;
    }

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
        recordSuccess(retryKey);
        stats.settled++;
      } else {
        const errorText = await settleResponse.text();
        console.error(`[Monitor] Settlement failed for escrow ${escrow.id}: ${settleResponse.status} - ${errorText}`);

        if (isPermanentError(errorText)) {
          console.warn(`[Monitor] Escrow ${escrow.id}: PERMANENT error — ${errorText.slice(0, 120)}. Will not retry. Top up wallet or cancel escrow.`);
          retryState.set(retryKey, { count: MAX_RETRIES + 1, nextRetryAt: Infinity, lastError: errorText.slice(0, 200) });
        } else {
          recordFailure(retryKey, errorText.slice(0, 200));
        }
        stats.errors++;
      }
    } catch (settleError: any) {
      const msg = settleError?.message || String(settleError);
      console.error(`[Monitor] Error settling escrow ${escrow.id}:`, msg);
      recordFailure(retryKey, msg.slice(0, 200));
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
      const retryKey = `series:${series.id}`;

      if (!shouldRetry(retryKey)) {
        const state = retryState.get(retryKey);
        if (state && state.count === MAX_RETRIES) {
          console.warn(`[Monitor] Series ${series.id} skipped — max retries exceeded (${state.lastError})`);
          state.count++;
        }
        continue;
      }

      stats.processed++;
      try {
        let childCreated = false;

        if (series.payment_method === 'crypto') {
          // ESC-NEW-06: call the service directly rather than POSTing to our own
          // API with `Bearer INTERNAL_API_KEY`.
          //
          // `/api/escrow` authenticates via `authenticateRequest`, which has no
          // notion of an internal key — it resolves merchant JWTs and business
          // API keys. Every request this path made was therefore rejected 401
          // and no series escrow was ever created here. It went unnoticed
          // because the primary cron (`series-monitor.ts`) creates them by
          // calling `createEscrow` directly and succeeds, so this fallback only
          // mattered when the primary was down — which is exactly when it was
          // needed.
          //
          // Server-side code calling server-side code has no reason to make an
          // HTTP round trip and re-authenticate to itself; doing so is what
          // created an auth mode that had to exist and did not.
          const escrowResult = await createEscrow(supabase, {
            business_id: series.merchant_id,
            chain: series.coin,
            amount: Number(series.amount),
            depositor_address: series.depositor_address,
            beneficiary_address: series.beneficiary_address,
            series_id: series.id,
            metadata: series.description ? { description: series.description } : undefined,
          });

          if (escrowResult.success && escrowResult.escrow) {
            childCreated = true;
            recordSuccess(retryKey);
            console.log(`[Monitor] Created crypto escrow ${escrowResult.escrow.id} for series ${series.id}`);
          } else {
            const errText = escrowResult.error || 'Unknown error';
            console.error(`[Monitor] Failed to create crypto escrow for series ${series.id}: ${errText}`);
            recordFailure(retryKey, errText.slice(0, 200));
            stats.errors++;
            continue;
          }
        } else if (series.payment_method === 'card') {
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
            recordSuccess(retryKey);
            console.log(`[Monitor] Created card payment for series ${series.id}`);
          } else {
            const errText = await res.text();
            console.error(`[Monitor] Failed to create card escrow for series ${series.id}: ${errText}`);
            recordFailure(retryKey, errText.slice(0, 200));
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
      } catch (seriesError: any) {
        const msg = seriesError?.message || String(seriesError);
        console.error(`[Monitor] Error processing series ${series.id}:`, msg);
        recordFailure(retryKey, msg.slice(0, 200));
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
