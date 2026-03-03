/**
 * Mutual Attestation Engine
 * Both parties (agent + buyer) attest after a transaction
 * Builds a verifiable trust graph
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidDid, sign } from './crypto';
import { z } from 'zod';

export const attestationSchema = z.object({
  receipt_id: z.string().uuid(),
  attester_did: z.string().refine(isValidDid, 'Invalid attester DID'),
  subject_did: z.string().refine(isValidDid, 'Invalid subject DID'),
  rating: z.number().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export type AttestationInput = z.infer<typeof attestationSchema>;

export interface MutualAttestationStatus {
  receipt_id: string;
  agent_attested: boolean;
  buyer_attested: boolean;
  complete: boolean;
}

/**
 * Submit an attestation for a completed transaction.
 * Each party (agent/buyer) can attest once per receipt.
 */
export async function submitAttestation(
  supabase: SupabaseClient,
  input: unknown
): Promise<{ success: boolean; attestation?: Record<string, unknown>; error?: string }> {
  const parsed = attestationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map(i => i.message).join(', ') };
  }

  const data = parsed.data;

  // Attester cannot attest themselves
  if (data.attester_did === data.subject_did) {
    return { success: false, error: 'Cannot attest yourself' };
  }

  // Verify receipt exists and attester is a party to it
  const { data: receipt } = await supabase
    .from('reputation_receipts')
    .select('agent_did, buyer_did, outcome')
    .eq('receipt_id', data.receipt_id)
    .single();

  if (!receipt) {
    return { success: false, error: 'Receipt not found' };
  }

  // Only accepted transactions can be mutually attested
  if (receipt.outcome !== 'accepted') {
    return { success: false, error: 'Only accepted transactions can be attested' };
  }

  // Attester must be agent or buyer on the receipt
  const isAgent = receipt.agent_did === data.attester_did;
  const isBuyer = receipt.buyer_did === data.attester_did;
  if (!isAgent && !isBuyer) {
    return { success: false, error: 'Attester is not a party to this transaction' };
  }

  // Subject must be the other party
  const expectedSubject = isAgent ? receipt.buyer_did : receipt.agent_did;
  if (data.subject_did !== expectedSubject) {
    return { success: false, error: 'Subject must be the other party in the transaction' };
  }

  // Check for duplicate attestation
  const { data: existing } = await supabase
    .from('mutual_attestations')
    .select('id')
    .eq('receipt_id', data.receipt_id)
    .eq('attester_did', data.attester_did)
    .single();

  if (existing) {
    return { success: false, error: 'Already attested for this transaction' };
  }

  // Sign the attestation
  const signature = sign(JSON.stringify({
    receipt_id: data.receipt_id,
    attester_did: data.attester_did,
    subject_did: data.subject_did,
    rating: data.rating,
  }));

  const { data: attestation, error } = await supabase
    .from('mutual_attestations')
    .insert({
      receipt_id: data.receipt_id,
      attester_did: data.attester_did,
      subject_did: data.subject_did,
      role: isAgent ? 'agent' : 'buyer',
      rating: data.rating,
      comment: data.comment,
      signature,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, attestation: attestation as Record<string, unknown> };
}

/**
 * Check mutual attestation status for a receipt
 */
export async function getAttestationStatus(
  supabase: SupabaseClient,
  receiptId: string
): Promise<MutualAttestationStatus> {
  const { data: attestations } = await supabase
    .from('mutual_attestations')
    .select('role')
    .eq('receipt_id', receiptId);

  const roles = (attestations || []).map((a: { role: string }) => a.role);

  return {
    receipt_id: receiptId,
    agent_attested: roles.includes('agent'),
    buyer_attested: roles.includes('buyer'),
    complete: roles.includes('agent') && roles.includes('buyer'),
  };
}

/**
 * Get average attestation rating for a DID (as subject)
 */
export async function getAttestationScore(
  supabase: SupabaseClient,
  subjectDid: string
): Promise<{ avg_rating: number; total_attestations: number; by_role: Record<string, { avg: number; count: number }> }> {
  const { data: attestations } = await supabase
    .from('mutual_attestations')
    .select('rating, role')
    .eq('subject_did', subjectDid);

  if (!attestations || attestations.length === 0) {
    return { avg_rating: 0, total_attestations: 0, by_role: {} };
  }

  const total = attestations.reduce((sum: number, a: { rating: number }) => sum + a.rating, 0);
  const byRole: Record<string, { avg: number; count: number }> = {};

  for (const a of attestations as Array<{ rating: number; role: string }>) {
    if (!byRole[a.role]) byRole[a.role] = { avg: 0, count: 0 };
    byRole[a.role].count++;
    byRole[a.role].avg += a.rating;
  }
  for (const role of Object.keys(byRole)) {
    byRole[role].avg = byRole[role].avg / byRole[role].count;
  }

  return {
    avg_rating: total / attestations.length,
    total_attestations: attestations.length,
    by_role: byRole,
  };
}
