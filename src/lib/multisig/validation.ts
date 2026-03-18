/**
 * Multisig Escrow Validation
 *
 * Zod schemas for all multisig escrow operations.
 */

import { z } from 'zod';

// ── Chain Validation ────────────────────────────────────────

export const multisigChainSchema = z.enum([
  'ETH', 'POL', 'BASE', 'ARB', 'OP', 'BNB', 'AVAX', // EVM
  'BTC', 'LTC', 'DOGE',                                // UTXO
  'SOL',                                                // Solana
], {
  required_error: 'chain is required',
  invalid_type_error: 'Unsupported multisig chain',
});

// ── Create Multisig Escrow ──────────────────────────────────

export const createMultisigEscrowSchema = z.object({
  chain: multisigChainSchema,
  amount: z.number({
    required_error: 'amount is required',
    invalid_type_error: 'amount must be a number',
  }).positive('amount must be greater than zero'),
  depositor_pubkey: z.string({
    required_error: 'depositor_pubkey is required',
  }).min(20, 'depositor_pubkey must be at least 20 characters'),
  beneficiary_pubkey: z.string({
    required_error: 'beneficiary_pubkey is required',
  }).min(20, 'beneficiary_pubkey must be at least 20 characters'),
  arbiter_pubkey: z.string({
    required_error: 'arbiter_pubkey is required',
  }).min(20, 'arbiter_pubkey must be at least 20 characters'),
  metadata: z.record(z.unknown()).optional(),
  business_id: z.string().uuid('business_id must be a valid UUID').optional(),
  expires_in_hours: z.number()
    .positive('expires_in_hours must be positive')
    .max(720, 'expires_in_hours must be at most 720 (30 days)')
    .optional(),
}).refine(
  (data) => data.depositor_pubkey !== data.beneficiary_pubkey,
  { message: 'Depositor and beneficiary must be different', path: ['beneficiary_pubkey'] },
).refine(
  (data) => data.depositor_pubkey !== data.arbiter_pubkey && data.beneficiary_pubkey !== data.arbiter_pubkey,
  { message: 'Arbiter must be different from depositor and beneficiary', path: ['arbiter_pubkey'] },
);

<<<<<<< HEAD
// ── Prepare Transaction ─────────────────────────────────────

export const prepareTransactionSchema = z.object({
=======
// ── Propose Transaction ─────────────────────────────────────

export const proposeTransactionSchema = z.object({
>>>>>>> feat/multisig-escrow
  proposal_type: z.enum(['release', 'refund'], {
    required_error: 'proposal_type is required',
  }),
  to_address: z.string({
    required_error: 'to_address is required',
  }).min(10, 'to_address must be at least 10 characters'),
  signer_pubkey: z.string({
    required_error: 'signer_pubkey is required',
  }).min(20, 'signer_pubkey must be at least 20 characters'),
});

// ── Sign Proposal ───────────────────────────────────────────

export const signProposalSchema = z.object({
  proposal_id: z.string({
    required_error: 'proposal_id is required',
  }).uuid('proposal_id must be a valid UUID'),
  signer_pubkey: z.string({
    required_error: 'signer_pubkey is required',
  }).min(20, 'signer_pubkey must be at least 20 characters'),
  signature: z.string({
    required_error: 'signature is required',
  }).min(10, 'signature must be at least 10 characters'),
});

// ── Broadcast Transaction ───────────────────────────────────

export const broadcastTransactionSchema = z.object({
  proposal_id: z.string({
    required_error: 'proposal_id is required',
  }).uuid('proposal_id must be a valid UUID'),
});

// ── Dispute ─────────────────────────────────────────────────

export const disputeSchema = z.object({
  signer_pubkey: z.string({
    required_error: 'signer_pubkey is required',
  }).min(20, 'signer_pubkey must be at least 20 characters'),
  reason: z.string({
    required_error: 'reason is required',
  }).min(10, 'Dispute reason must be at least 10 characters')
    .max(2000, 'Dispute reason must be at most 2000 characters'),
});
