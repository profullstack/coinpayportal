/**
 * Escrow Monitor
 *
 * Handles all escrow monitoring logic:
 * 1. Check pending (created) escrows for deposits or expiration
 * 1b. Auto-refund funded escrows that have expired
 * 2. Trigger settlement for released escrows
 * 3. Trigger on-chain refund for refunded escrows
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { checkBalance } from './balance-checkers';
import type { EscrowStats } from './types';
import { randomUUID } from 'crypto';

/**
 * Run the full escrow monitoring cycle
 */
export async function monitorEscrows(
  supabase: SupabaseClient,
  now: Date
): Promise<EscrowStats> {
  const stats: EscrowStats = { checked: 0, funded: 0, expired: 0, errors: 0 };

  try {
    // 1. Check pending escrows for deposits
    await checkPendingEscrows(supabase, now, stats);

    // 1b. Auto-refund funded escrows that have expired
    await autoRefundExpiredFundedEscrows(supabase, now, stats);

    // 2. Process released escrows (trigger settlement/forwarding)
    await settleReleasedEscrows(supabase);

    // 3. Process refunded escrows (return funds to depositor)
    await settleRefundedEscrows(supabase);
  } catch (escrowMonitorError) {
    console.error('Escrow monitor error:', escrowMonitorError);
  }

  return stats;
}

/**
 * Step 1: Check pending (created) escrows for deposits or expiration
 */
async function checkPendingEscrows(
  supabase: SupabaseClient,
  now: Date,
  stats: EscrowStats
): Promise<void> {
  const { data: pendingEscrows, error: escrowFetchError } = await supabase
    .from('escrows')
    .select('id, escrow_address, chain, amount, status, expires_at')
    .eq('status', 'created')
    .limit(50);

  if (escrowFetchError || !pendingEscrows) return;

  console.log(`Processing ${pendingEscrows.length} pending escrows`);

  for (const escrow of pendingEscrows) {
    stats.checked++;
    try {
      // Check if expired
      if (new Date(escrow.expires_at) < now) {
        await supabase
          .from('escrows')
          .update({ status: 'expired' })
          .eq('id', escrow.id)
          .eq('status', 'created');
        await supabase.from('escrow_events').insert({
          escrow_id: escrow.id,
          event_type: 'expired',
          actor: 'system',
          details: {},
        });
        stats.expired++;
        console.log(`Escrow ${escrow.id} expired`);
        continue;
      }

      // Check balance on-chain
      const balance = await checkBalance(escrow.escrow_address, escrow.chain);
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
          .eq('status', 'created');
        await supabase.from('escrow_events').insert({
          escrow_id: escrow.id,
          event_type: 'funded',
          actor: 'system',
          details: { deposited_amount: balance },
        });
        stats.funded++;
        console.log(`Escrow ${escrow.id} funded with ${balance}`);
      }
    } catch (escrowError) {
      console.error(`Error processing escrow ${escrow.id}:`, escrowError);
      stats.errors++;
    }
  }
}

/**
 * Step 1b: Auto-refund funded escrows that have expired
 */
async function autoRefundExpiredFundedEscrows(
  supabase: SupabaseClient,
  now: Date,
  stats: EscrowStats
): Promise<void> {
  const { data: expiredFundedEscrows } = await supabase
    .from('escrows')
    .select('id, escrow_address, chain, amount, deposited_amount, depositor_address, expires_at')
    .eq('status', 'funded')
    .lt('expires_at', now.toISOString())
    .limit(20);

  if (!expiredFundedEscrows || expiredFundedEscrows.length === 0) return;

  console.log(`Auto-refunding ${expiredFundedEscrows.length} expired funded escrows`);

  for (const escrow of expiredFundedEscrows) {
    try {
      await supabase
        .from('escrows')
        .update({
          status: 'refunded',
          refunded_at: now.toISOString(),
        })
        .eq('id', escrow.id)
        .eq('status', 'funded');

      await supabase.from('escrow_events').insert({
        escrow_id: escrow.id,
        event_type: 'refunded',
        actor: 'system',
        details: {
          reason: 'Escrow expired — auto-refund to depositor',
          refund_to: escrow.depositor_address,
          amount: escrow.deposited_amount || escrow.amount,
        },
      });

      console.log(`Escrow ${escrow.id} expired while funded — marked for refund`);
    } catch (expiredRefundError) {
      console.error(`Error auto-refunding expired escrow ${escrow.id}:`, expiredRefundError);
      stats.errors++;
    }
  }
}

/**
 * Step 2: Trigger settlement for released escrows
 */
async function settleReleasedEscrows(supabase: SupabaseClient): Promise<void> {
  const MAX_SETTLE_ATTEMPTS = 3;
  const { data: releasedEscrows } = await supabase
    .from('escrows')
    .select('id, escrow_address, escrow_address_id, chain, amount, deposited_amount, fee_amount, beneficiary_address, business_id, settle_attempts')
    .eq('status', 'released')
    .or(`settle_attempts.is.null,settle_attempts.lt.${MAX_SETTLE_ATTEMPTS}`)
    .limit(20);

  if (!releasedEscrows || releasedEscrows.length === 0) return;

  console.log(`Processing ${releasedEscrows.length} released escrows for settlement`);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const internalApiKey = process.env.INTERNAL_API_KEY;

  // Chains that support automated on-chain settlement
  const SETTLEABLE_CHAINS = ['BTC', 'ETH', 'SOL', 'POL', 'BCH', 'BNB', 'DOGE', 'XRP', 'ADA', 'USDC_ETH', 'USDC_SOL', 'USDC_POL'];

  for (const escrow of releasedEscrows) {
    // Skip chains without sendTransaction support to avoid retry spam
    if (!SETTLEABLE_CHAINS.includes(escrow.chain)) {
      console.log(`[Monitor] Skipping escrow ${escrow.id} — chain ${escrow.chain} requires manual settlement`);
      continue;
    }

    try {
      if (internalApiKey) {
        const settleResponse = await fetch(`${appUrl}/api/escrow/${escrow.id}/settle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${internalApiKey}`,
          },
        });
        if (settleResponse.ok) {
          console.log(`Settlement triggered for escrow ${escrow.id}`);
          // Generate reputation receipt for settled escrow
          try {
            await generateReputationReceipt(supabase, escrow);
          } catch (repErr) {
            console.error(`Reputation receipt error for escrow ${escrow.id}:`, repErr);
          }
        } else {
          const body = await settleResponse.text();
          console.error(`[Monitor] Settlement failed for escrow ${escrow.id}: ${settleResponse.status} - ${body}`);
          const attempts = (escrow.settle_attempts || 0) + 1;
          await supabase.from('escrows').update({ settle_attempts: attempts }).eq('id', escrow.id);
          if (attempts >= MAX_SETTLE_ATTEMPTS) {
            console.error(`[Monitor] Escrow ${escrow.id} exceeded max settle attempts (${MAX_SETTLE_ATTEMPTS}), marking as settle_failed`);
            await supabase.from('escrows').update({ status: 'settle_failed' }).eq('id', escrow.id);
          }
        }
      }
    } catch (settleError) {
      console.error(`[Monitor] Escrow settle error ${escrow.id}:`, settleError);
      const attempts = (escrow.settle_attempts || 0) + 1;
      await supabase.from('escrows').update({ settle_attempts: attempts }).eq('id', escrow.id);
      if (attempts >= MAX_SETTLE_ATTEMPTS) {
        console.error(`[Monitor] Escrow ${escrow.id} exceeded max settle attempts, marking as settle_failed`);
        await supabase.from('escrows').update({ status: 'settle_failed' }).eq('id', escrow.id);
      }
    }
  }
}

/**
 * Step 3: Trigger on-chain refund for refunded escrows without settlement TX
 */
async function settleRefundedEscrows(supabase: SupabaseClient): Promise<void> {
  const { data: refundedEscrows } = await supabase
    .from('escrows')
    .select('id, escrow_address, escrow_address_id, chain, deposited_amount, depositor_address')
    .eq('status', 'refunded')
    .is('settlement_tx_hash', null)
    .limit(20);

  if (!refundedEscrows || refundedEscrows.length === 0) return;

  console.log(`Processing ${refundedEscrows.length} refunded escrows`);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const internalApiKey = process.env.INTERNAL_API_KEY;

  for (const escrow of refundedEscrows) {
    try {
      if (internalApiKey) {
        const refundResponse = await fetch(`${appUrl}/api/escrow/${escrow.id}/settle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${internalApiKey}`,
          },
          body: JSON.stringify({ action: 'refund' }),
        });
        if (refundResponse.ok) {
          console.log(`Refund triggered for escrow ${escrow.id}`);
        } else {
          console.error(`Refund failed for escrow ${escrow.id}: ${refundResponse.status}`);
        }
      }
    } catch (refundError) {
      console.error(`Error refunding escrow ${escrow.id}:`, refundError);
    }
  }
}

/**
 * Generate a reputation receipt when an escrow is settled
 */
async function generateReputationReceipt(
  supabase: SupabaseClient,
  escrow: Record<string, unknown>
): Promise<void> {
  const receiptId = randomUUID();
  const { error } = await supabase.from('reputation_receipts').insert({
    receipt_id: receiptId,
    task_id: escrow.id,
    agent_did: `did:coinpay:beneficiary:${escrow.beneficiary_address}`,
    buyer_did: `did:coinpay:depositor:${escrow.business_id || 'unknown'}`,
    platform_did: 'did:web:coinpayportal.com',
    escrow_tx: escrow.id,
    amount: Number(escrow.amount) || 0,
    currency: escrow.chain as string,
    category: 'escrow_settlement',
    outcome: 'accepted',
    dispute: false,
    signatures: { escrow_sig: `auto:${escrow.id}` },
    finalized_at: new Date().toISOString(),
  });
  if (error) {
    console.error(`Failed to create reputation receipt for escrow ${escrow.id}:`, error.message);
  } else {
    console.log(`Reputation receipt ${receiptId} created for escrow ${escrow.id}`);
  }
}
