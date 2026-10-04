/**
 * Recurring Escrow Series Monitor
 *
 * Processes active escrow series where next_charge_at <= now:
 * 1. Creates the next escrow in the series
 * 2. Increments periods_completed
 * 3. Advances next_charge_at
 * 4. Marks series completed when max_periods reached
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createEscrow } from '@/lib/escrow';
import { isBusinessPaidTier } from '@/lib/entitlements/service';

export interface SeriesStats {
  checked: number;
  created: number;
  completed: number;
  errors: number;
}

/**
 * Advance next_charge_at based on interval
 */
function advanceNextCharge(current: Date, interval: string): Date {
  const next = new Date(current);
  if (interval === 'weekly') next.setDate(next.getDate() + 7);
  else if (interval === 'biweekly') next.setDate(next.getDate() + 14);
  else next.setMonth(next.getMonth() + 1); // monthly
  return next;
}

export async function monitorSeries(
  supabase: SupabaseClient,
  now: Date
): Promise<SeriesStats> {
  const stats: SeriesStats = { checked: 0, created: 0, completed: 0, errors: 0 };

  try {
    // Find active series due for next charge
    const { data: dueSeries, error } = await supabase
      .from('escrow_series')
      .select('*')
      .eq('status', 'active')
      .lte('next_charge_at', now.toISOString())
      .limit(20);

    if (error || !dueSeries || dueSeries.length === 0) return stats;

    console.log(`[Series] Processing ${dueSeries.length} due recurring series`);

    for (const series of dueSeries) {
      stats.checked++;
      try {
        const nextPeriod = (series.periods_completed || 0) + 1;

        // Check if we've hit max periods
        if (series.max_periods && nextPeriod > series.max_periods) {
          await supabase
            .from('escrow_series')
            .update({ status: 'completed', updated_at: now.toISOString() })
            .eq('id', series.id);
          stats.completed++;
          console.log(`[Series] ${series.id} completed (${series.max_periods} periods)`);
          continue;
        }

        // Need both addresses to create escrow
        if (!series.depositor_address || !series.beneficiary_address) {
          console.log(`[Series] ${series.id} skipped — missing depositor or beneficiary address`);
          continue;
        }

        // H-R-04: claim the period BEFORE creating anything for it.
        //
        // This used to create the escrow first and then write
        // `periods_completed`/`next_charge_at` with only `.eq('id', ...)` — no
        // compare-and-swap against the state it had read. Two overlapping cron
        // runs therefore both read the same `periods_completed`, both created an
        // escrow for the same period, and both wrote the same next period: the
        // subscriber is billed twice and the counter advances once, so nothing
        // downstream shows that it happened. Overlapping runs are not
        // hypothetical — a slow run and the next tick is all it takes.
        //
        // Conditioning the write on the values that were read makes the row
        // itself the lock. The loser sees zero rows updated and skips the
        // period rather than duplicating it.
        const nextChargeAt = advanceNextCharge(new Date(series.next_charge_at), series.interval);

        const { data: claimed } = await supabase
          .from('escrow_series')
          .update({
            periods_completed: nextPeriod,
            next_charge_at: nextChargeAt.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', series.id)
          .eq('periods_completed', series.periods_completed ?? 0)
          .eq('next_charge_at', series.next_charge_at)
          .select('id');

        if (!claimed || claimed.length === 0) {
          console.log(`[Series] ${series.id} period ${nextPeriod} already claimed by another run — skipping`);
          continue;
        }

        const isPaidTier = await isBusinessPaidTier(supabase, series.merchant_id).catch(() => false);

        const expiresMap: Record<string, number> = { weekly: 168, biweekly: 336, monthly: 720 };

        const escrowResult = await createEscrow(supabase, {
          chain: series.coin,
          amount: Number(series.amount),
          depositor_address: series.depositor_address,
          beneficiary_address: series.beneficiary_address,
          business_id: series.merchant_id,
          series_id: series.id,
          expires_in_hours: expiresMap[series.interval] || 168,
          metadata: {
            period: nextPeriod,
            description: series.description || undefined,
          },
          allow_auto_release: Boolean(series.allow_auto_release),
        }, isPaidTier);

        if (escrowResult.success) {
          stats.created++;
          console.log(`[Series] ${series.id} period ${nextPeriod} escrow created, next charge: ${nextChargeAt.toISOString()}`);
        } else {
          // The period was claimed but nothing was created for it, so give it
          // back. Conditioned on the values this run wrote, so a concurrent
          // run that has since moved the series on is not rolled backwards.
          console.error(`[Series] ${series.id} failed to create escrow: ${escrowResult.error}`);
          const { error: revertError } = await supabase
            .from('escrow_series')
            .update({
              periods_completed: series.periods_completed ?? 0,
              next_charge_at: series.next_charge_at,
              updated_at: now.toISOString(),
            })
            .eq('id', series.id)
            .eq('periods_completed', nextPeriod)
            .eq('next_charge_at', nextChargeAt.toISOString());

          if (revertError) {
            console.error(
              `[Series] ${series.id}: escrow creation failed AND the period claim could not be released — ` +
                `period ${nextPeriod} will be skipped:`,
              revertError
            );
          }
          stats.errors++;
        }
      } catch (seriesError) {
        console.error(`[Series] Error processing series ${series.id}:`, seriesError);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('[Series] Monitor error:', err);
  }

  return stats;
}
