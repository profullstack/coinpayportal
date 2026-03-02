/**
 * Lightning Service — Supabase wrapper for LN nodes, offers, and payments.
 *
 * Node provisioning and LN wallet management is handled by LNbits (see lnbits.ts).
 * This service manages the ln_nodes, ln_offers, and ln_payments tables.
 */

import { createClient } from '@supabase/supabase-js';
import type {
  LnNode,
  LnOffer,
  LnPayment,
  CreateOfferParams,
  InvoicePaidEvent,
} from './types';

export class LightningService {
  private supabase;

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing Supabase environment variables');
    }
    this.supabase = createClient(url, key);
  }

  async getNode(nodeId: string): Promise<LnNode | null> {
    const { data, error } = await this.supabase
      .from('ln_nodes')
      .select('*')
      .eq('id', nodeId)
      .single();
    if (error) return null;
    return data as LnNode;
  }

  async createOffer(params: CreateOfferParams & { bolt12_offer: string }): Promise<LnOffer> {
    const { node_id, business_id, description, amount_msat, currency, bolt12_offer } = params;
    const node = await this.getNode(node_id);
    if (!node) throw new Error('Node not found');
    if (node.status !== 'active') throw new Error('Node is not active');

    const { data, error } = await this.supabase
      .from('ln_offers')
      .insert({
        id: crypto.randomUUID(),
        node_id,
        business_id: business_id || node.business_id || null,
        bolt12_offer,
        description,
        amount_msat: amount_msat || null,
        currency: currency || 'BTC',
        status: 'active',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create offer: ${error.message}`);
    return data as LnOffer;
  }

  async getOffer(offerId: string): Promise<LnOffer | null> {
    const { data, error } = await this.supabase
      .from('ln_offers')
      .select('*')
      .eq('id', offerId)
      .single();
    if (error) return null;
    return data as LnOffer;
  }

  async listOffers(filters: {
    business_id?: string;
    node_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ offers: LnOffer[]; total: number }> {
    let query = this.supabase.from('ln_offers').select('*', { count: 'exact' });
    if (filters.business_id) query = query.eq('business_id', filters.business_id);
    if (filters.node_id) query = query.eq('node_id', filters.node_id);
    if (filters.status) query = query.eq('status', filters.status);
    query = query.order('created_at', { ascending: false })
      .range(filters.offset || 0, (filters.offset || 0) + (filters.limit || 20) - 1);
    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list offers: ${error.message}`);
    return { offers: (data || []) as LnOffer[], total: count || 0 };
  }

  async listPayments(filters: {
    node_id?: string;
    wallet_id?: string;
    business_id?: string;
    offer_id?: string;
    direction?: 'incoming' | 'outgoing';
    status?: string;
    include_rebalances?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ payments: LnPayment[]; total: number }> {
    let query = this.supabase.from('ln_payments').select('*', { count: 'exact' });

    if (filters.node_id) {
      query = query.eq('node_id', filters.node_id);
    } else if (filters.wallet_id) {
      const { data: nodes, error: nodesError } = await this.supabase
        .from('ln_nodes').select('id').eq('wallet_id', filters.wallet_id);
      if (nodesError) throw new Error(`Failed to resolve wallet nodes: ${nodesError.message}`);
      const nodeIds = (nodes || []).map((n: any) => n.id).filter(Boolean);
      if (nodeIds.length === 0) return { payments: [], total: 0 };
      query = query.in('node_id', nodeIds);
    }

    if (filters.business_id) query = query.eq('business_id', filters.business_id);
    if (filters.offer_id) query = query.eq('offer_id', filters.offer_id);
    if (filters.direction) query = query.eq('direction', filters.direction);
    if (filters.status) query = query.eq('status', filters.status);
    if (!filters.include_rebalances) {
      query = query.eq('payment_type', 'payment');
    }
    query = query.order('created_at', { ascending: false })
      .range(filters.offset || 0, (filters.offset || 0) + (filters.limit || 50) - 1);
    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list payments: ${error.message}`);
    return { payments: (data || []) as LnPayment[], total: count || 0 };
  }

  async getPaymentStatus(paymentHash: string): Promise<LnPayment | null> {
    const { data, error } = await this.supabase
      .from('ln_payments').select('*').eq('payment_hash', paymentHash).single();
    if (error) return null;
    return data as LnPayment;
  }

  subscribePayments(nodeId: string, callback: (event: InvoicePaidEvent) => void): () => void {
    const channel = this.supabase
      .channel(`ln-payments-${nodeId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ln_payments',
        filter: `node_id=eq.${nodeId}`,
      }, (payload) => {
        const payment = payload.new as LnPayment;
        callback({
          payment_hash: payment.payment_hash,
          preimage: payment.preimage || '',
          amount_msat: payment.amount_msat,
          bolt12_offer: '',
          payer_note: payment.payer_note || undefined,
        });
      })
      .subscribe();
    return () => { this.supabase.removeChannel(channel); };
  }

  async recordPayment(params: {
    offer_id?: string | null;
    direction: 'incoming' | 'outgoing';
    node_id: string;
    business_id?: string;
    payment_hash: string;
    preimage?: string;
    amount_msat: number;
    payer_note?: string;
  }): Promise<LnPayment> {
    if (params.direction === 'incoming' && (!params.offer_id || params.offer_id.trim().length === 0)) {
      throw new Error('offer_id is required for incoming payments');
    }
    const { data, error } = await this.supabase
      .from('ln_payments')
      .insert({ ...params, offer_id: params.offer_id ?? null, status: 'settled', settled_at: new Date().toISOString() })
      .select().single();
    if (error) throw new Error(`Failed to record payment: ${error.message}`);
    return data as LnPayment;
  }
}

let _instance: LightningService | null = null;
export function getLightningService(): LightningService {
  if (!_instance) { _instance = new LightningService(); }
  return _instance;
}
