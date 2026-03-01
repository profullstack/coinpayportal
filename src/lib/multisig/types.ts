/**
 * Multisig Escrow Types
 *
 * 2-of-3 multisig escrow: Depositor, Beneficiary, CoinPay (Arbiter).
 * CoinPay can never move funds alone — always requires 2 of 3 signers.
 */

// ── Chain Types ─────────────────────────────────────────────

/** EVM chains supported by Safe adapter */
export type EvmChain = 'ETH' | 'POL' | 'BASE' | 'ARB' | 'OP' | 'BNB' | 'AVAX';

/** UTXO chains supported by BTC multisig adapter */
export type UtxoChain = 'BTC' | 'LTC' | 'DOGE';

/** Solana chain */
export type SolanaChain = 'SOL';

/** All chains supported by multisig */
export type MultisigChain = EvmChain | UtxoChain | SolanaChain;

// ── Escrow Model ────────────────────────────────────────────

export type EscrowModel = 'custodial' | 'multisig_2of3';

export type MultisigEscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'settled'
  | 'disputed'
  | 'refunded'
  | 'expired';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_release'
  | 'resolved_refund';

export type ProposalType = 'release' | 'refund';

export type ProposalStatus = 'pending' | 'approved' | 'executed' | 'cancelled';

export type SignerRole = 'depositor' | 'beneficiary' | 'arbiter';

// ── Core Interfaces ─────────────────────────────────────────

export interface MultisigParticipants {
  depositor_pubkey: string;
  beneficiary_pubkey: string;
  arbiter_pubkey: string;
}

export interface CreateMultisigEscrowInput {
  chain: MultisigChain;
  amount: number;
  depositor_pubkey: string;
  beneficiary_pubkey: string;
  arbiter_pubkey: string;
  metadata?: Record<string, unknown>;
  business_id?: string;
  expires_in_hours?: number;
}

export interface MultisigEscrow {
  id: string;
  escrow_model: 'multisig_2of3';
  chain: MultisigChain;
  threshold: 2;
  depositor_pubkey: string;
  beneficiary_pubkey: string;
  arbiter_pubkey: string;
  escrow_address: string;
  chain_metadata: Record<string, unknown>;
  amount: number;
  amount_usd: number | null;
  status: MultisigEscrowStatus;
  dispute_status: DisputeStatus | null;
  dispute_reason: string | null;
  metadata: Record<string, unknown>;
  business_id: string | null;
  funded_at: string | null;
  settled_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface MultisigProposal {
  id: string;
  escrow_id: string;
  proposal_type: ProposalType;
  to_address: string;
  amount: number;
  chain_tx_data: Record<string, unknown>;
  status: ProposalStatus;
  created_by: string;
  created_at: string;
  executed_at: string | null;
  tx_hash: string | null;
}

export interface MultisigSignature {
  id: string;
  proposal_id: string;
  signer_role: SignerRole;
  signer_pubkey: string;
  signature: string;
  signed_at: string;
}

// ── Adapter Interfaces ──────────────────────────────────────

/** Result of creating a multisig wallet on-chain */
export interface CreateMultisigResult {
  escrow_address: string;
  chain_metadata: Record<string, unknown>;
}

/** Data needed to propose a transaction */
export interface ProposeTransactionInput {
  escrow_address: string;
  to_address: string;
  amount: number;
  chain_metadata: Record<string, unknown>;
}

/** Result of proposing a transaction */
export interface ProposeTransactionResult {
  tx_data: Record<string, unknown>;
  tx_hash_to_sign: string;
}

/** Result of adding a signature */
export interface AddSignatureResult {
  signatures_collected: number;
  threshold_met: boolean;
}

/** Result of broadcasting */
export interface BroadcastResult {
  tx_hash: string;
  success: boolean;
}

// ── API Response Types ──────────────────────────────────────

export interface CreateMultisigEscrowResult {
  success: boolean;
  escrow?: MultisigEscrow;
  error?: string;
}

export interface ProposeResult {
  success: boolean;
  proposal?: MultisigProposal;
  tx_data?: Record<string, unknown>;
  error?: string;
}

export interface SignResult {
  success: boolean;
  signature?: MultisigSignature;
  signatures_collected?: number;
  threshold_met?: boolean;
  error?: string;
}

export interface BroadcastResultResponse {
  success: boolean;
  tx_hash?: string;
  proposal?: MultisigProposal;
  error?: string;
}

export interface DisputeResult {
  success: boolean;
  escrow?: MultisigEscrow;
  error?: string;
}
