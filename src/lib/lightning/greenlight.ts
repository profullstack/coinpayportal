/**
 * Greenlight Service — CLN-as-a-service client for BOLT12 Lightning
 *
 * Wraps Greenlight/CLN gRPC to provision nodes, create BOLT12 offers,
 * and manage payments. Uses the wallet's BIP39 seed to derive LN node
 * identity via m/535h/0h derivation path.
 *
 * NOTE: In production, this connects to Blockstream's Greenlight service.
 * For development, it can connect to a local CLN node via Unix socket.
 */

import { HDKey } from '@scure/bip32';
import { createClient } from '@supabase/supabase-js';
import type {
  LnNode,
  LnOffer,
  LnPayment,
  ProvisionNodeParams,
  CreateOfferParams,
  GreenlightNodeInfo,
  InvoicePaidEvent,
} from './types';

// ──────────────────────────────────────────────
// LN Seed Derivation
// ──────────────────────────────────────────────

/**
 * Derive Lightning node keys from a BIP39 seed.
 * Uses derivation path m/535h/0h (535 = "LN" in l33t, hardened).
 * This ensures the LN node identity is deterministically derived
 * from the same mnemonic used for on-chain wallets.
 */
export function deriveLnNodeKeys(seed: Buffer): {
  nodeSeed: Buffer;
  nodePublicKey: string;
} {
  const hdKey = HDKey.fromMasterSeed(seed);
  const lnKey = hdKey.derive("m/535'/0'");

  if (!lnKey.privateKey) {
    throw new Error('Failed to derive LN node key');
  }

  return {
    nodeSeed: Buffer.from(lnKey.privateKey),
    nodePublicKey: lnKey.publicKey
      ? Buffer.from(lnKey.publicKey).toString('hex')
      : '',
  };
}

// ──────────────────────────────────────────────
// Greenlight Service
// ──────────────────────────────────────────────

export class GreenlightService {
  private supabase;

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing Supabase environment variables');
    }
    this.supabase = createClient(url, key);
  }

  /**
   * Provision a new Greenlight CLN node for a wallet.
   * Derives LN identity from the wallet's BIP39 seed.
   */
  async provisionNode(params: ProvisionNodeParams): Promise<LnNode> {
    const { wallet_id, business_id, seed } = params;

    // Derive LN node keys from seed
    const { nodeSeed, nodePublicKey } = deriveLnNodeKeys(seed);

    // In production: call Greenlight API to register/schedule the node
    // gl.Scheduler.register(nodeSeed) → returns node_id
    // For now, we create the DB record and mark as active
    const greenlightNodeId = `gl-${Buffer.from(nodeSeed.subarray(0, 8)).toString('hex')}`;

    const { data, error } = await this.supabase
      .from('ln_nodes')
      .insert({
        wallet_id,
        business_id: business_id || null,
        greenlight_node_id: greenlightNodeId,
        node_pubkey: nodePublicKey,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to provision node: ${error.message}`);
    }

    return data as LnNode;
  }

  /**
   * Get node info by ID.
   */
  async getNode(nodeId: string): Promise<LnNode | null> {
    const { data, error } = await this.supabase
      .from('ln_nodes')
      .select('*')
      .eq('id', nodeId)
      .single();

    if (error) return null;
    return data as LnNode;
  }

  /**
   * Create a BOLT12 offer on a Greenlight node.
   * In production: calls CLN's `offer` command via Greenlight gRPC.
   */
  async createOffer(params: CreateOfferParams): Promise<LnOffer> {
    const { node_id, business_id, description, amount_msat, currency } = params;

    // Verify node exists and is active
    const node = await this.getNode(node_id);
    if (!node) throw new Error('Node not found');
    if (node.status !== 'active') throw new Error('Node is not active');

    // In production: call CLN via Greenlight
    // const clnResult = await glNode.offer({
    //   amount: amount_msat ? `${amount_msat}msat` : 'any',
    //   description,
    //   label: offerId,
    // });
    //
    // For now, generate a placeholder BOLT12 offer string
    const offerId = crypto.randomUUID();
    const bolt12Offer = generatePlaceholderBolt12(
      node.node_pubkey || '',
      description,
      amount_msat
    );

    const { data, error } = await this.supabase
      .from('ln_offers')
      .insert({
        id: offerId,
        node_id,
        business_id: business_id || node.business_id || null,
        bolt12_offer: bolt12Offer,
        description,
        amount_msat: amount_msat || null,
        currency: currency || 'BTC',
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create offer: ${error.message}`);
    }

    return data as LnOffer;
  }

  /**
   * Get offer by ID.
   */
  async getOffer(offerId: string): Promise<LnOffer | null> {
    const { data, error } = await this.supabase
      .from('ln_offers')
      .select('*')
      .eq('id', offerId)
      .single();

    if (error) return null;
    return data as LnOffer;
  }

  /**
   * List offers for a business or node.
   */
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

    query = query
      .order('created_at', { ascending: false })
      .range(
        filters.offset || 0,
        (filters.offset || 0) + (filters.limit || 20) - 1
      );

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to list offers: ${error.message}`);

    return {
      offers: (data || []) as LnOffer[],
      total: count || 0,
    };
  }

  /**
   * List payments for a node, optionally filtered by offer.
   */
  async listPayments(filters: {
    node_id?: string;
    business_id?: string;
    offer_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ payments: LnPayment[]; total: number }> {
    let query = this.supabase.from('ln_payments').select('*', { count: 'exact' });

    if (filters.node_id) query = query.eq('node_id', filters.node_id);
    if (filters.business_id) query = query.eq('business_id', filters.business_id);
    if (filters.offer_id) query = query.eq('offer_id', filters.offer_id);
    if (filters.status) query = query.eq('status', filters.status);

    query = query
      .order('created_at', { ascending: false })
      .range(
        filters.offset || 0,
        (filters.offset || 0) + (filters.limit || 50) - 1
      );

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to list payments: ${error.message}`);

    return {
      payments: (data || []) as LnPayment[],
      total: count || 0,
    };
  }

  /**
   * Get payment status by payment hash.
   */
  async getPaymentStatus(paymentHash: string): Promise<LnPayment | null> {
    const { data, error } = await this.supabase
      .from('ln_payments')
      .select('*')
      .eq('payment_hash', paymentHash)
      .single();

    if (error) return null;
    return data as LnPayment;
  }

  /**
   * Get settled payments from CLN since a given pay_index.
   * Used by the payment monitor daemon to poll for new payments.
   *
   * In production: calls CLN listinvoices via Greenlight gRPC,
   * filtered to status=paid with pay_index > lastPayIndex.
   */
  async getSettledPayments(
    greenlightNodeId: string,
    lastPayIndex: number
  ): Promise<
    Array<{
      payment_hash: string;
      preimage: string;
      amount_msat: number;
      pay_index: number;
      bolt12_offer: string | null;
      payer_note: string | null;
      settled_at: string;
    }>
  > {
    // Call the Python Greenlight SDK via child process
    // (no Node.js SDK available — gl-client is Python/Rust only)
    const { execFileSync } = await import('child_process');
    const path = await import('path');
    const network = process.env.GL_NETWORK || 'bitcoin';

    // Try multiple possible Python paths
    const pythonPaths = [
      '/app/.venv/bin/python3',
      '/tmp/glvenv/bin/python3',
      'python3',
    ];
    const scriptPath = path.join(process.cwd(), 'scripts', 'check-invoices.py');

    // Check if script exists
    const fs = await import('fs');
    if (!fs.existsSync(scriptPath)) {
      console.log('[Greenlight] check-invoices.py not found, skipping');
      return [];
    }

    for (const pythonPath of pythonPaths) {
      try {
        const result = execFileSync(pythonPath, [
          scriptPath,
          greenlightNodeId,
          String(lastPayIndex),
          network,
        ], {
          timeout: 30_000,
          encoding: 'utf-8',
        });

        const parsed = JSON.parse(result.trim());
        if (parsed.error) {
          console.error(`[Greenlight] check-invoices error: ${parsed.error}`);
          return [];
        }

        return (parsed.payments || []).map((p: Record<string, unknown>) => ({
          payment_hash: p.payment_hash as string,
          preimage: (p.preimage as string) || '',
          amount_msat: p.amount_msat as number,
          pay_index: p.pay_index as number,
          bolt12_offer: (p.bolt12_offer as string) || null,
          payer_note: (p.payer_note as string) || null,
          settled_at: p.settled_at
            ? new Date((p.settled_at as number) * 1000).toISOString()
            : new Date().toISOString(),
        }));
      } catch (err) {
        // Try next python path
        continue;
      }
    }

    console.error('[Greenlight] Failed to run check-invoices.py with any Python path');
    return [];
  }

  /**
   * Subscribe to incoming payments for a node.
   * In production: uses CLN's waitanyinvoice via Greenlight gRPC streaming.
   * Returns an unsubscribe function.
   */
  subscribePayments(
    nodeId: string,
    callback: (event: InvoicePaidEvent) => void
  ): () => void {
    // In production: this would open a gRPC stream to Greenlight
    // and call waitanyinvoice in a loop.
    //
    // const stream = glNode.waitAnyInvoice({ lastpay_index: 0 });
    // stream.on('data', (invoice) => callback(mapToEvent(invoice)));
    //
    // For now, set up a Supabase realtime subscription
    const channel = this.supabase
      .channel(`ln-payments-${nodeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ln_payments',
          filter: `node_id=eq.${nodeId}`,
        },
        (payload) => {
          const payment = payload.new as LnPayment;
          callback({
            payment_hash: payment.payment_hash,
            preimage: payment.preimage || '',
            amount_msat: payment.amount_msat,
            bolt12_offer: '', // Would come from CLN event
            payer_note: payment.payer_note || undefined,
          });
        }
      )
      .subscribe();

    return () => {
      this.supabase.removeChannel(channel);
    };
  }

  /**
   * Record a settled payment (called by webhook/settlement worker).
   */
  async recordPayment(params: {
    offer_id: string;
    node_id: string;
    business_id?: string;
    payment_hash: string;
    preimage?: string;
    amount_msat: number;
    payer_note?: string;
  }): Promise<LnPayment> {
    const { data, error } = await this.supabase
      .from('ln_payments')
      .insert({
        ...params,
        status: 'settled',
        settled_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to record payment: ${error.message}`);
    }

    return data as LnPayment;
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Generate a placeholder BOLT12 offer string for development.
 * In production, CLN generates real bech32m-encoded offers.
 */
function generatePlaceholderBolt12(
  nodePubkey: string,
  description: string,
  amountMsat?: number
): string {
  // Real BOLT12 offers start with "lno1" and are bech32m encoded.
  // This placeholder is for development/testing only.
  const payload = Buffer.from(
    JSON.stringify({
      node: nodePubkey.substring(0, 16),
      desc: description.substring(0, 32),
      amt: amountMsat || 'any',
      t: Date.now(),
    })
  ).toString('hex');
  return `lno1${payload}`;
}

// Singleton export
let _instance: GreenlightService | null = null;

export function getGreenlightService(): GreenlightService {
  if (!_instance) {
    _instance = new GreenlightService();
  }
  return _instance;
}
