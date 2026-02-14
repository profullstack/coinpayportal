/**
 * Lightning / BOLT12 TypeScript types
 */

export interface LnNode {
  id: string;
  wallet_id: string;
  business_id: string | null;
  greenlight_node_id: string | null;
  node_pubkey: string | null;
  status: 'provisioning' | 'active' | 'inactive' | 'error';
  created_at: string;
  updated_at: string;
}

export interface LnOffer {
  id: string;
  node_id: string;
  business_id: string | null;
  bolt12_offer: string;
  description: string;
  amount_msat: number | null;
  currency: string;
  status: 'active' | 'disabled' | 'archived';
  total_received_msat: number;
  payment_count: number;
  last_payment_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LnPayment {
  id: string;
  offer_id: string;
  node_id: string;
  business_id: string | null;
  payment_hash: string;
  preimage: string | null;
  amount_msat: number;
  status: 'pending' | 'settled' | 'failed';
  payer_note: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface ProvisionNodeParams {
  wallet_id: string;
  business_id?: string;
  seed: Buffer;
}

export interface CreateOfferParams {
  node_id: string;
  business_id?: string;
  description: string;
  amount_msat?: number;
  currency?: string;
}

export interface GreenlightNodeInfo {
  node_id: string;
  pubkey: string;
  alias: string;
}

export interface InvoicePaidEvent {
  payment_hash: string;
  preimage: string;
  amount_msat: number;
  bolt12_offer: string;
  payer_note?: string;
  label?: string;
}
