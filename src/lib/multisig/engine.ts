/**
 * Multisig Escrow Engine
 *
 * Chain-agnostic orchestration layer for 2-of-3 multisig escrows.
 * Routes operations to the appropriate chain adapter and manages
 * escrow lifecycle, proposal tracking, and signature collection.
 *
 * Architecture:
 *   EscrowEngine (this file)
 *     → ChainAdapter (evm-safe / btc-multisig / solana-multisig)
 *       → On-chain multisig implementation
 *
 * Core Rule: CoinPay can never move funds alone.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChainAdapter } from './adapters/interface';
import { getAdapterType } from './adapters/interface';
import { evmSafeAdapter } from './adapters/evm-safe';
import { btcMultisigAdapter } from './adapters/btc-multisig';
import { solanaMultisigAdapter } from './adapters/solana-multisig';
import type {
  MultisigChain,
  MultisigEscrow,
  MultisigProposal,
  MultisigSignature,
  CreateMultisigEscrowInput,
  CreateMultisigEscrowResult,
  ProposeResult,
  SignResult,
  BroadcastResultResponse,
  DisputeResult,
  SignerRole,
  ProposalType,
} from './types';

// ── Feature Flags ───────────────────────────────────────────

export function isMultisigEnabled(): boolean {
  return process.env.MULTISIG_ESCROW_ENABLED === 'true';
}

export function isMultisigDefault(): boolean {
  return process.env.MULTISIG_DEFAULT === 'true';
}

// ── Adapter Registry ────────────────────────────────────────

const adapters: Record<string, ChainAdapter> = {
  evm: evmSafeAdapter,
  utxo: btcMultisigAdapter,
  solana: solanaMultisigAdapter,
};

function getAdapter(chain: MultisigChain): ChainAdapter {
  const type = getAdapterType(chain);
  const adapter = adapters[type];
  if (!adapter) {
    throw new Error(`No adapter found for chain: ${chain}`);
  }
  return adapter;
}

// ── Event Logging ───────────────────────────────────────────

async function logEvent(
  supabase: SupabaseClient,
  escrowId: string,
  eventType: string,
  actor: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from('escrow_events').insert({
    escrow_id: escrowId,
    event_type: eventType,
    actor,
    details,
  });
}

// ── Signer Role Resolution ──────────────────────────────────

function resolveSignerRole(
  escrow: MultisigEscrow,
  signerPubkey: string,
): SignerRole | null {
  if (signerPubkey === escrow.depositor_pubkey) return 'depositor';
  if (signerPubkey === escrow.beneficiary_pubkey) return 'beneficiary';
  if (signerPubkey === escrow.arbiter_pubkey) return 'arbiter';
  return null;
}

// ── Core Engine Functions ───────────────────────────────────

/**
 * Create a new 2-of-3 multisig escrow.
 *
 * 1. Validate input
 * 2. Route to chain adapter to create multisig wallet
 * 3. Persist escrow record with chain_metadata
 * 4. Return escrow details with deposit address
 */
export async function createMultisigEscrow(
  supabase: SupabaseClient,
  input: CreateMultisigEscrowInput,
): Promise<CreateMultisigEscrowResult> {
  if (!isMultisigEnabled()) {
    return { success: false, error: 'Multisig escrow is not enabled' };
  }

  try {
    const adapter = getAdapter(input.chain);

    // Create multisig on-chain
    const result = await adapter.createMultisig(
      input.chain,
      {
        depositor_pubkey: input.depositor_pubkey,
        beneficiary_pubkey: input.beneficiary_pubkey,
        arbiter_pubkey: input.arbiter_pubkey,
      },
      2, // threshold always 2
    );

    // Calculate expiry
    const expiresInHours = input.expires_in_hours || 24;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

    // Persist escrow
    const { data: escrow, error: insertError } = await supabase
      .from('escrows')
      .insert({
        escrow_model: 'multisig_2of3',
        chain: input.chain,
        threshold: 2,
        depositor_pubkey: input.depositor_pubkey,
        beneficiary_pubkey: input.beneficiary_pubkey,
        arbiter_pubkey: input.arbiter_pubkey,
        escrow_address: result.escrow_address,
        chain_metadata: result.chain_metadata,
        amount: input.amount,
        status: 'pending',
        metadata: input.metadata || {},
        business_id: input.business_id || null,
        expires_at: expiresAt,
        // Multisig escrows don't use token-based auth — they use pubkey signatures
        depositor_address: input.depositor_pubkey,
        beneficiary_address: input.beneficiary_pubkey,
        arbiter_address: input.arbiter_pubkey,
        release_token: `msig_${crypto.randomUUID()}`,
        beneficiary_token: `msig_${crypto.randomUUID()}`,
      })
      .select()
      .single();

    if (insertError || !escrow) {
      return { success: false, error: `Failed to create escrow: ${insertError?.message}` };
    }

    await logEvent(supabase, escrow.id, 'multisig_created', input.depositor_pubkey, {
      chain: input.chain,
      escrow_model: 'multisig_2of3',
      threshold: 2,
      escrow_address: result.escrow_address,
      amount: input.amount,
    });

    return {
      success: true,
      escrow: {
        id: escrow.id,
        escrow_model: 'multisig_2of3',
        chain: input.chain as MultisigChain,
        threshold: 2,
        depositor_pubkey: input.depositor_pubkey,
        beneficiary_pubkey: input.beneficiary_pubkey,
        arbiter_pubkey: input.arbiter_pubkey,
        escrow_address: result.escrow_address,
        chain_metadata: result.chain_metadata,
        amount: input.amount,
        amount_usd: escrow.amount_usd ?? null,
        status: 'pending',
        dispute_status: null,
        dispute_reason: null,
        metadata: input.metadata || {},
        business_id: input.business_id || null,
        funded_at: null,
        settled_at: null,
        created_at: escrow.created_at,
        expires_at: expiresAt,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create multisig escrow',
    };
  }
}

/**
 * Propose a transaction (release to beneficiary or refund to depositor).
 *
 * Only depositor or beneficiary can propose.
 * Arbiter can propose during disputes.
 */
export async function proposeTransaction(
  supabase: SupabaseClient,
  escrowId: string,
  proposalType: ProposalType,
  toAddress: string,
  signerPubkey: string,
): Promise<ProposeResult> {
  // Fetch escrow
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .eq('escrow_model', 'multisig_2of3')
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Multisig escrow not found' };
  }

  // Verify signer is a participant
  const role = resolveSignerRole(escrow as unknown as MultisigEscrow, signerPubkey);
  if (!role) {
    return { success: false, error: 'Signer is not a participant in this escrow' };
  }

  // Validate escrow status
  if (escrow.status !== 'funded' && escrow.status !== 'disputed') {
    return { success: false, error: `Cannot propose transaction in status: ${escrow.status}` };
  }

<<<<<<< HEAD
  // Arbiter may only propose while disputed
  if (role === 'arbiter' && escrow.status !== 'disputed') {
    return { success: false, error: 'Arbiter can only propose during disputes' };
  }

  // Enforce canonical payout recipients by proposal type
  if (proposalType === 'release' && toAddress !== escrow.beneficiary_pubkey) {
    return { success: false, error: 'Release proposals must pay the beneficiary address' };
  }
  if (proposalType === 'refund' && toAddress !== escrow.depositor_pubkey) {
    return { success: false, error: 'Refund proposals must pay the depositor address' };
  }

=======
>>>>>>> feat/multisig-escrow
  // Authorization rules
  if (proposalType === 'release' && role === 'beneficiary') {
    // Beneficiary cannot self-release — needs depositor or arbiter
    return { success: false, error: 'Beneficiary cannot propose a release' };
  }
  if (proposalType === 'refund' && role === 'depositor') {
    // Depositor cannot self-refund — needs beneficiary or arbiter approval
    // But can propose it
  }

  // Check for existing pending proposals
  const { data: existingProposals } = await supabase
    .from('multisig_proposals')
    .select('id')
    .eq('escrow_id', escrowId)
    .eq('status', 'pending');

  if (existingProposals && existingProposals.length > 0) {
    return { success: false, error: 'A pending proposal already exists for this escrow' };
  }

  try {
    const adapter = getAdapter(escrow.chain as MultisigChain);

    // Build the transaction proposal
    const txResult = await adapter.proposeTransaction(
      escrow.chain as MultisigChain,
      {
        escrow_address: escrow.escrow_address,
        to_address: toAddress,
        amount: Number(escrow.amount),
        chain_metadata: escrow.chain_metadata || {},
      },
    );

    // Persist proposal
    const { data: proposal, error: insertError } = await supabase
      .from('multisig_proposals')
      .insert({
        escrow_id: escrowId,
        proposal_type: proposalType,
        to_address: toAddress,
        amount: escrow.amount,
<<<<<<< HEAD
        chain_tx_data: {
          ...txResult.tx_data,
          tx_hash_to_sign: txResult.tx_hash_to_sign,
        },
=======
        chain_tx_data: txResult.tx_data,
>>>>>>> feat/multisig-escrow
        status: 'pending',
        created_by: signerPubkey,
      })
      .select()
      .single();

    if (insertError || !proposal) {
      return { success: false, error: `Failed to create proposal: ${insertError?.message}` };
    }

    await logEvent(supabase, escrowId, 'proposal_created', signerPubkey, {
      proposal_id: proposal.id,
      proposal_type: proposalType,
      to_address: toAddress,
      tx_hash_to_sign: txResult.tx_hash_to_sign,
    });

    return {
      success: true,
      proposal: proposal as MultisigProposal,
      tx_data: {
        ...txResult.tx_data,
        tx_hash_to_sign: txResult.tx_hash_to_sign,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to propose transaction',
    };
  }
}

/**
 * Add a signature to an existing proposal.
 *
 * Each participant can sign once. When threshold (2) is reached,
 * the proposal can be broadcast.
 */
export async function signProposal(
  supabase: SupabaseClient,
  escrowId: string,
  proposalId: string,
  signerPubkey: string,
  signature: string,
): Promise<SignResult> {
  // Fetch escrow
  const { data: escrow, error: escrowError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .eq('escrow_model', 'multisig_2of3')
    .single();

  if (escrowError || !escrow) {
    return { success: false, error: 'Multisig escrow not found' };
  }

  // Verify signer is a participant
  const role = resolveSignerRole(escrow as unknown as MultisigEscrow, signerPubkey);
  if (!role) {
    return { success: false, error: 'Signer is not a participant in this escrow' };
  }

  // Fetch proposal
  const { data: proposal, error: proposalError } = await supabase
    .from('multisig_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('escrow_id', escrowId)
    .eq('status', 'pending')
    .single();

  if (proposalError || !proposal) {
    return { success: false, error: 'Pending proposal not found' };
  }

  // Check for duplicate signature
  const { data: existingSig } = await supabase
    .from('multisig_signatures')
    .select('id')
    .eq('proposal_id', proposalId)
    .eq('signer_role', role)
    .single();

  if (existingSig) {
    return { success: false, error: `${role} has already signed this proposal` };
  }

  // Verify signature with adapter
  const adapter = getAdapter(escrow.chain as MultisigChain);
  const isValid = await adapter.verifySignature(
    escrow.chain as MultisigChain,
    proposal.chain_tx_data || {},
    signature,
    signerPubkey,
  );

  if (!isValid) {
    return { success: false, error: 'Invalid signature' };
  }

  // Store signature
  const { data: sigRecord, error: sigError } = await supabase
    .from('multisig_signatures')
    .insert({
      proposal_id: proposalId,
      signer_role: role,
      signer_pubkey: signerPubkey,
      signature,
    })
    .select()
    .single();

  if (sigError || !sigRecord) {
    return { success: false, error: `Failed to store signature: ${sigError?.message}` };
  }

  // Count total signatures
  const { count } = await supabase
    .from('multisig_signatures')
    .select('*', { count: 'exact', head: true })
    .eq('proposal_id', proposalId);

  const sigCount = count || 1;
  const thresholdMet = sigCount >= (escrow.threshold || 2);

  // If threshold met, mark proposal as approved
  if (thresholdMet) {
    await supabase
      .from('multisig_proposals')
      .update({ status: 'approved' })
      .eq('id', proposalId);
  }

  await logEvent(supabase, escrowId, 'signature_added', signerPubkey, {
    proposal_id: proposalId,
    signer_role: role,
    signatures_collected: sigCount,
    threshold_met: thresholdMet,
  });

  return {
    success: true,
    signature: sigRecord as MultisigSignature,
    signatures_collected: sigCount,
    threshold_met: thresholdMet,
  };
}

/**
 * Broadcast an approved proposal on-chain.
 *
 * Requires the proposal to have status 'approved' (threshold met).
 * Combines all signatures and sends the transaction.
 */
export async function broadcastTransaction(
  supabase: SupabaseClient,
  escrowId: string,
  proposalId: string,
): Promise<BroadcastResultResponse> {
  // Fetch escrow
  const { data: escrow, error: escrowError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .eq('escrow_model', 'multisig_2of3')
    .single();

  if (escrowError || !escrow) {
    return { success: false, error: 'Multisig escrow not found' };
  }

  // Fetch proposal
  const { data: proposal, error: proposalError } = await supabase
    .from('multisig_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('escrow_id', escrowId)
    .single();

  if (proposalError || !proposal) {
    return { success: false, error: 'Proposal not found' };
  }

  if (proposal.status !== 'approved') {
    return { success: false, error: `Cannot broadcast proposal in status: ${proposal.status}` };
  }

  // Fetch all signatures
  const { data: signatures, error: sigError } = await supabase
    .from('multisig_signatures')
    .select('*')
    .eq('proposal_id', proposalId);

  if (sigError || !signatures || signatures.length < (escrow.threshold || 2)) {
    return { success: false, error: 'Insufficient signatures' };
  }

  try {
    const adapter = getAdapter(escrow.chain as MultisigChain);

    // Broadcast the transaction
    const result = await adapter.broadcastTransaction(
      escrow.chain as MultisigChain,
      proposal.chain_tx_data || {},
      signatures.map((s: MultisigSignature) => ({
        pubkey: s.signer_pubkey,
        signature: s.signature,
      })),
    );

    if (!result.success) {
      return { success: false, error: 'Broadcast failed' };
    }

<<<<<<< HEAD
    if (result.broadcasted !== true) {
      // Prepared/simulated success path: do not mutate proposal/escrow state yet.
      return {
        success: true,
        tx_hash: result.tx_hash,
        proposal: proposal as MultisigProposal,
        broadcasted: false,
        stage: 'prepared',
      };
    }

=======
>>>>>>> feat/multisig-escrow
    // Update proposal
    await supabase
      .from('multisig_proposals')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        tx_hash: result.tx_hash,
      })
      .eq('id', proposalId);

    // Update escrow status based on proposal type
    const newStatus = proposal.proposal_type === 'release' ? 'settled' : 'refunded';
    const updateFields: Record<string, unknown> = {
      status: newStatus,
      settlement_tx_hash: result.tx_hash,
    };
    if (newStatus === 'settled') {
      updateFields.settled_at = new Date().toISOString();
    }

    await supabase
      .from('escrows')
      .update(updateFields)
      .eq('id', escrowId);

    await logEvent(supabase, escrowId, 'tx_broadcast', 'system', {
      proposal_id: proposalId,
      proposal_type: proposal.proposal_type,
      tx_hash: result.tx_hash,
      new_status: newStatus,
    });

    return {
      success: true,
      tx_hash: result.tx_hash,
<<<<<<< HEAD
      broadcasted: true,
      stage: 'broadcasted',
=======
>>>>>>> feat/multisig-escrow
      proposal: {
        ...proposal,
        status: 'executed',
        tx_hash: result.tx_hash,
      } as MultisigProposal,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Broadcast failed',
    };
  }
}

/**
 * Open a dispute on a multisig escrow.
 *
 * Either depositor or beneficiary can open a dispute.
 * Once disputed, the arbiter can propose resolution.
 */
export async function disputeMultisigEscrow(
  supabase: SupabaseClient,
  escrowId: string,
  signerPubkey: string,
  reason: string,
): Promise<DisputeResult> {
  // Fetch escrow
  const { data: escrow, error: fetchError } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .eq('escrow_model', 'multisig_2of3')
    .single();

  if (fetchError || !escrow) {
    return { success: false, error: 'Multisig escrow not found' };
  }

  // Verify signer is depositor or beneficiary
  const role = resolveSignerRole(escrow as unknown as MultisigEscrow, signerPubkey);
  if (!role || role === 'arbiter') {
    return { success: false, error: 'Only depositor or beneficiary can open a dispute' };
  }

  if (escrow.status !== 'funded') {
    return { success: false, error: `Cannot dispute escrow in status: ${escrow.status}` };
  }

  // Update escrow
  const { data: updated, error: updateError } = await supabase
    .from('escrows')
    .update({
      status: 'disputed',
      dispute_status: 'open',
      dispute_reason: reason,
      disputed_at: new Date().toISOString(),
    })
    .eq('id', escrowId)
    .eq('status', 'funded')
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: 'Failed to open dispute' };
  }

  // Cancel any pending proposals
  await supabase
    .from('multisig_proposals')
    .update({ status: 'cancelled' })
    .eq('escrow_id', escrowId)
    .eq('status', 'pending');

  await logEvent(supabase, escrowId, 'disputed', signerPubkey, {
    role,
    reason,
    dispute_status: 'open',
  });

  return {
    success: true,
    escrow: {
      ...updated,
      escrow_model: 'multisig_2of3',
      threshold: 2,
      chain: updated.chain as MultisigChain,
      amount: Number(updated.amount),
      dispute_status: 'open',
    } as MultisigEscrow,
  };
}

/**
 * Get a multisig escrow by ID.
 */
export async function getMultisigEscrow(
  supabase: SupabaseClient,
  escrowId: string,
): Promise<CreateMultisigEscrowResult> {
  const { data: escrow, error } = await supabase
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .eq('escrow_model', 'multisig_2of3')
    .single();

  if (error || !escrow) {
    return { success: false, error: 'Multisig escrow not found' };
  }

  return {
    success: true,
    escrow: {
      id: escrow.id,
      escrow_model: 'multisig_2of3',
      chain: escrow.chain as MultisigChain,
      threshold: 2,
      depositor_pubkey: escrow.depositor_pubkey,
      beneficiary_pubkey: escrow.beneficiary_pubkey,
      arbiter_pubkey: escrow.arbiter_pubkey,
      escrow_address: escrow.escrow_address,
      chain_metadata: escrow.chain_metadata || {},
      amount: Number(escrow.amount),
      amount_usd: escrow.amount_usd ? Number(escrow.amount_usd) : null,
      status: escrow.status,
      dispute_status: escrow.dispute_status || null,
      dispute_reason: escrow.dispute_reason || null,
      metadata: escrow.metadata || {},
      business_id: escrow.business_id || null,
      funded_at: escrow.funded_at || null,
      settled_at: escrow.settled_at || null,
      created_at: escrow.created_at,
      expires_at: escrow.expires_at,
    },
  };
}

/**
 * Get proposals for a multisig escrow.
 */
export async function getProposals(
  supabase: SupabaseClient,
  escrowId: string,
): Promise<{ success: boolean; proposals?: MultisigProposal[]; error?: string }> {
  const { data, error } = await supabase
    .from('multisig_proposals')
    .select('*')
    .eq('escrow_id', escrowId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: 'Failed to fetch proposals' };
  }

  return { success: true, proposals: (data || []) as MultisigProposal[] };
}

/**
 * Get signatures for a proposal.
 */
export async function getSignatures(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<{ success: boolean; signatures?: MultisigSignature[]; error?: string }> {
  const { data, error } = await supabase
    .from('multisig_signatures')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('signed_at', { ascending: true });

  if (error) {
    return { success: false, error: 'Failed to fetch signatures' };
  }

  return { success: true, signatures: (data || []) as MultisigSignature[] };
}
