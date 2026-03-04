/**
 * Background Payment Monitor
 *
 * This module provides a self-starting background monitor that checks
 * pending payments for blockchain balances and updates their status.
 *
 * It runs independently of user sessions, ensuring payments are detected
 * even if users close the payment page after sending funds.
 */

import { createClient } from '@supabase/supabase-js';
import { runWalletTxCycle } from '../web-wallet/tx-finalize';
import { processPayment, type Payment } from './monitor-balance';
import { runEscrowCycle, runRecurringEscrowCycle } from './monitor-escrow';
import { runInvoiceMonitorCycle, runInvoiceSchedulerCycle } from './monitor-invoices';

// Configuration
const MONITOR_INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '15000', 10);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Track if monitor is running
let isMonitorRunning = false;
let isCycleInProgress = false;
let monitorInterval: NodeJS.Timeout | null = null;

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


 */
export function startMonitor(): void {
  if (isMonitorRunning) {
    console.log('[Monitor] Already running');
    return;
  }
  
  // Only run on server side
  if (typeof window !== 'undefined') {
    console.log('[Monitor] Cannot run in browser');
    return;
  }
  
  console.log(`[Monitor] Starting background payment monitor (interval: ${MONITOR_INTERVAL_MS}ms)`);
  isMonitorRunning = true;
  
  // Run immediately
  runMonitorCycle().catch(err => {
    console.error('[Monitor] Fatal error in initial cycle:', err?.message || err);
  });
  
  // Then run on interval
  monitorInterval = setInterval(() => {
    runMonitorCycle().catch(err => {
      console.error('[Monitor] Fatal error in cycle:', err?.message || err);
    });
  }, MONITOR_INTERVAL_MS);
}

/**
 * Stop the background monitor
 */
export function stopMonitor(): void {
  if (!isMonitorRunning) {
    console.log('[Monitor] Not running');
    return;
  }
  
  console.log('[Monitor] Stopping background payment monitor');
  isMonitorRunning = false;
  
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

/**
 * Check if monitor is running
 */
export function isMonitorActive(): boolean {
  return isMonitorRunning;
}

/**
 * Run a single monitor cycle (for testing or manual trigger)
 */
export async function runOnce(): Promise<{ checked: number; confirmed: number; expired: number; errors: number }> {
  return runMonitorCycle();
}

