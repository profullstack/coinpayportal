/**
 * Escrow Service Types
 */

export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'settled'
  | 'disputed'
  | 'refunded'
  | 'expired';

export type EscrowEventType =
  | 'pending'
  | 'funded'
  | 'released'
  | 'settled'
  | 'disputed'
  | 'dispute_resolved'
  | 'refunded'
  | 'expired'
  | 'metadata_updated';

export type EscrowChain =
  | 'BTC' | 'BCH' | 'ETH' | 'POL' | 'SOL'
  | 'DOGE' | 'XRP' | 'ADA' | 'BNB'
  | 'USDT' | 'USDC'
  | 'USDC_ETH' | 'USDC_POL' | 'USDC_SOL';

export interface CreateEscrowInput {
  chain: EscrowChain;
  amount: number;                          // crypto amount
  depositor_address: string;               // where refunds go
  beneficiary_address: string;             // where releases go
  arbiter_address?: string;                // optional dispute resolver
  metadata?: Record<string, unknown>;      // job details, milestones, etc.
  business_id?: string;                    // optional merchant association
  series_id?: string;                      // recurring series link
  expires_in_hours?: number;               // default 24h
}

export interface Escrow {
  id: string;
  depositor_address: string;
  beneficiary_address: string;
  arbiter_address: string | null;
  escrow_address_id: string | null;
  escrow_address: string;
  chain: EscrowChain;
  amount: number;
  amount_usd: number | null;
  fee_amount: number | null;
  deposited_amount: number | null;
  status: EscrowStatus;
  deposit_tx_hash: string | null;
  settlement_tx_hash: string | null;
  fee_tx_hash: string | null;
  metadata: Record<string, unknown>;
  dispute_reason: string | null;
  dispute_resolution: string | null;
  release_token: string;
  beneficiary_token: string;
  business_id: string | null;
  created_at: string;
  funded_at: string | null;
  released_at: string | null;
  settled_at: string | null;
  disputed_at: string | null;
  refunded_at: string | null;
  expires_at: string;
  updated_at: string;
}

/** Public view — tokens are NOT exposed */
export interface EscrowPublic {
  id: string;
  depositor_address: string;
  beneficiary_address: string;
  arbiter_address: string | null;
  escrow_address: string;
  chain: EscrowChain;
  amount: number;
  amount_usd: number | null;
  fee_amount: number | null;
  deposited_amount: number | null;
  status: EscrowStatus;
  deposit_tx_hash: string | null;
  settlement_tx_hash: string | null;
  metadata: Record<string, unknown>;
  dispute_reason: string | null;
  dispute_resolution: string | null;
  created_at: string;
  funded_at: string | null;
  released_at: string | null;
  settled_at: string | null;
  disputed_at: string | null;
  refunded_at: string | null;
  expires_at: string;
}

export interface EscrowEvent {
  id: string;
  escrow_id: string;
  event_type: EscrowEventType;
  actor: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CreateEscrowResult {
  success: boolean;
  escrow?: EscrowPublic & {
    release_token: string;
    beneficiary_token: string;
  };
  error?: string;
}

export interface EscrowActionResult {
  success: boolean;
  escrow?: EscrowPublic;
  error?: string;
}
