/**
 * Reputation Protocol — Receipt Service
 * Receipt validation, storage, signature verification
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { validateReceiptSignatures, isValidDid } from './crypto';
import { checkMinimumThreshold } from './anti-gaming';
import { CANONICAL_CATEGORIES, isValidActionCategory } from './trust-engine';
import { z } from 'zod';

export const receiptSchema = z.object({
  receipt_id: z.string().uuid(),
  task_id: z.string().uuid(),
  agent_did: z.string().refine(isValidDid, 'Invalid agent DID format'),
  buyer_did: z.string().refine(isValidDid, 'Invalid buyer DID format'),
  platform_did: z.string().optional(),
  escrow_tx: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  category: z.string().optional(),
  action_category: z.string().optional().default('economic.transaction'),
  action_type: z.string().optional(),
  sla: z.record(z.unknown()).optional(),
  outcome: z.enum(['accepted', 'rejected', 'disputed']),
  dispute: z.boolean().optional().default(false),
  artifact_hash: z.string().optional(),
  signatures: z.object({
    escrow_sig: z.string(),
    agent_sig: z.string().optional(),
    buyer_sig: z.string().optional(),
    arbitration_sig: z.string().optional(),
  }),
  finalized_at: z.string().optional(),
});

export type ReceiptInput = z.infer<typeof receiptSchema>;

/**
 * Validate and store a task receipt
 */
export async function submitReceipt(
  supabase: SupabaseClient,
  input: unknown
): Promise<{ success: boolean; receipt?: Record<string, unknown>; error?: string }> {
  // Validate schema
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map(i => i.message).join(', ') };
  }

  const data = parsed.data;

  // Validate action_category if provided
  if (data.action_category && !isValidActionCategory(data.action_category)) {
    return { success: false, error: `Invalid action_category: ${data.action_category}. Must be one of: ${CANONICAL_CATEGORIES.join(', ')}` };
  }

  // Validate signatures
  const sigCheck = validateReceiptSignatures(data.signatures);
  if (!sigCheck.valid) {
    return { success: false, error: sigCheck.reason };
  }

  // Check minimum economic threshold
  if (data.amount !== undefined && !checkMinimumThreshold(data.amount)) {
    return { success: false, error: 'Amount below minimum economic threshold' };
  }

  // If platform_did is coinpayportal, verify escrow_tx exists
  if (data.platform_did === 'did:web:coinpayportal.com' && data.escrow_tx) {
    const { data: escrow } = await supabase
      .from('escrows')
      .select('id')
      .eq('id', data.escrow_tx)
      .single();

    if (!escrow) {
      return { success: false, error: 'Escrow transaction not found in our system' };
    }
  }

  // Check for duplicates
  const { data: existing } = await supabase
    .from('reputation_receipts')
    .select('id')
    .eq('receipt_id', data.receipt_id)
    .single();

  if (existing) {
    return { success: false, error: 'Duplicate receipt_id' };
  }

  // Store receipt
  const { data: receipt, error } = await supabase
    .from('reputation_receipts')
    .insert({
      receipt_id: data.receipt_id,
      task_id: data.task_id,
      agent_did: data.agent_did,
      buyer_did: data.buyer_did,
      platform_did: data.platform_did,
      escrow_tx: data.escrow_tx,
      amount: data.amount,
      currency: data.currency,
      category: data.category,
      action_category: data.action_category || 'economic.transaction',
      action_type: data.action_type,
      sla: data.sla,
      outcome: data.outcome,
      dispute: data.dispute,
      artifact_hash: data.artifact_hash,
      signatures: data.signatures,
      finalized_at: data.finalized_at || new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, receipt: receipt as Record<string, unknown> };
}
