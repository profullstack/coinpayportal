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
        }, isPaidTier);

        if (escrowResult.success) {
          const nextChargeAt = advanceNextCharge(new Date(series.next_charge_at), series.interval);

          await supabase
            .from('escrow_series')
            .update({
              periods_completed: nextPeriod,
              next_charge_at: nextChargeAt.toISOString(),
              updated_at: now.toISOString(),
            })
            .eq('id', series.id);

          stats.created++;
          console.log(`[Series] ${series.id} period ${nextPeriod} escrow created, next charge: ${nextChargeAt.toISOString()}`);
        } else {
          console.error(`[Series] ${series.id} failed to create escrow: ${escrowResult.error}`);
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
