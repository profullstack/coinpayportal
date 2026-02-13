/**
 * Reputation Protocol — Receipt Service
 * Validation, storage, signature verification for task receipts
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { verifySignature } from './crypto';

export interface TaskReceipt {
  receipt_id: string;
  task_id: string;
  agent_did: string;
  buyer_did: string;
  platform_did: string;
  escrow_tx?: string;
  amount: number;
  currency: string;
  category?: string;
  sla?: Record<string, unknown>;
  outcome: 'completed' | 'failed' | 'disputed' | 'cancelled';
  dispute?: boolean;
  artifact_hash?: string;
  signatures: {
    agent?: string;
    buyer?: string;
    platform?: string;
  };
  finalized_at?: string;
}

const REQUIRED_FIELDS = [
  'receipt_id', 'task_id', 'agent_did', 'buyer_did', 'platform_did',
  'amount', 'currency', 'outcome', 'signatures',
] as const;

const VALID_OUTCOMES = ['completed', 'failed', 'disputed', 'cancelled'];

/**
 * Validate a receipt schema
 */
export function validateReceipt(receipt: Partial<TaskReceipt>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (receipt[field] === undefined || receipt[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (receipt.outcome && !VALID_OUTCOMES.includes(receipt.outcome)) {
    errors.push(`Invalid outcome: ${receipt.outcome}`);
  }

  if (receipt.amount !== undefined && (typeof receipt.amount !== 'number' || receipt.amount <= 0)) {
    errors.push('Amount must be a positive number');
  }

  if (receipt.signatures && typeof receipt.signatures !== 'object') {
    errors.push('Signatures must be an object');
  }

  if (receipt.signatures && !receipt.signatures.agent && !receipt.signatures.buyer && !receipt.signatures.platform) {
    errors.push('At least one signature is required');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Verify receipt signatures
 */
export function verifyReceiptSignatures(receipt: TaskReceipt): { valid: boolean; verified: string[] } {
  const verified: string[] = [];
  const data = `${receipt.receipt_id}:${receipt.task_id}:${receipt.agent_did}:${receipt.buyer_did}:${receipt.amount}:${receipt.outcome}`;

  if (receipt.signatures.agent && verifySignature(data, receipt.signatures.agent, receipt.agent_did)) {
    verified.push('agent');
  }
  if (receipt.signatures.buyer && verifySignature(data, receipt.signatures.buyer, receipt.buyer_did)) {
    verified.push('buyer');
  }
  if (receipt.signatures.platform && verifySignature(data, receipt.signatures.platform, receipt.platform_did)) {
    verified.push('platform');
  }

  return { valid: verified.length > 0, verified };
}

/**
 * Verify escrow transaction exists
 */
export async function verifyEscrowTx(
  supabase: SupabaseClient,
  escrowTx: string
): Promise<boolean> {
  if (!escrowTx) return true; // Optional field

  const { data } = await supabase
    .from('escrows')
    .select('id')
    .eq('id', escrowTx)
    .single();

  return !!data;
}

/**
 * Store an immutable receipt
 */
export async function storeReceipt(
  supabase: SupabaseClient,
  receipt: TaskReceipt
): Promise<{ success: boolean; id?: string; error?: string }> {
  // Check for duplicate
  const { data: existing } = await supabase
    .from('reputation_receipts')
    .select('id')
    .eq('receipt_id', receipt.receipt_id)
    .single();

  if (existing) {
    return { success: false, error: 'Duplicate receipt_id' };
  }

  const { data, error } = await supabase
    .from('reputation_receipts')
    .insert({
      receipt_id: receipt.receipt_id,
      task_id: receipt.task_id,
      agent_did: receipt.agent_did,
      buyer_did: receipt.buyer_did,
      platform_did: receipt.platform_did,
      escrow_tx: receipt.escrow_tx || null,
      amount: receipt.amount,
      currency: receipt.currency,
      category: receipt.category || 'general',
      sla: receipt.sla || null,
      outcome: receipt.outcome,
      dispute: receipt.dispute || receipt.outcome === 'disputed',
      artifact_hash: receipt.artifact_hash || null,
      signatures: receipt.signatures,
      finalized_at: receipt.finalized_at || new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

/**
 * Generate a receipt from an escrow settlement
 */
export function generateReceiptFromEscrow(escrow: {
  id: string;
  chain: string;
  amount: number;
  deposited_amount?: number;
  beneficiary_address: string;
  escrow_address: string;
  metadata?: Record<string, unknown>;
  business_id?: string;
}): Partial<TaskReceipt> {
  return {
    receipt_id: `esc-${escrow.id}`,
    task_id: escrow.metadata?.task_id as string || escrow.id,
    agent_did: `did:wallet:${escrow.beneficiary_address}`,
    buyer_did: `did:wallet:${escrow.escrow_address}`,
    platform_did: escrow.business_id
      ? `did:biz:${escrow.business_id}`
      : 'did:web:coinpayportal.com',
    escrow_tx: escrow.id,
    amount: escrow.deposited_amount || escrow.amount,
    currency: escrow.chain,
    category: escrow.metadata?.category as string || 'general',
    outcome: 'completed',
    dispute: false,
  };
}
