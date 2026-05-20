/**
 * Portable reputation events — a signed, cross-app event log keyed on DID.
 * Every platform in the ecosystem writes the same shape; consumers verify
 * the HMAC instead of trusting the row.
 */

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sign, verifySignature, isValidDid } from './crypto';

export interface PortableReputationEvent {
  event_id: string;
  did: string;
  source_did: string;
  event_type: string;
  category: string | null;
  weight: number;
  source_rail: string | null;
  related_transaction_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  signature: string;
}

export interface RecordEventInput {
  did: string;
  source_did: string;
  event_type: string;
  category?: string | null;
  weight?: number;
  source_rail?: string | null;
  related_transaction_id?: string | null;
  metadata?: Record<string, unknown>;
  event_id?: string;
  created_at?: string;
}

interface SignablePayload {
  event_id: string;
  did: string;
  source_did: string;
  event_type: string;
  category: string | null;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

function canonical(e: SignablePayload): string {
  return JSON.stringify({
    event_id: e.event_id,
    did: e.did,
    source_did: e.source_did,
    event_type: e.event_type,
    category: e.category,
    weight: e.weight,
    metadata: e.metadata,
    created_at: e.created_at,
  });
}

export function signEvent(e: SignablePayload): string {
  return sign(canonical(e));
}

export function verifyEventSignature(e: PortableReputationEvent): boolean {
  return verifySignature(canonical({
    event_id: e.event_id,
    did: e.did,
    source_did: e.source_did,
    event_type: e.event_type,
    category: e.category,
    weight: e.weight,
    metadata: e.metadata ?? {},
    created_at: e.created_at,
  }), e.signature);
}

export async function recordReputationEvent(
  supabase: SupabaseClient,
  input: RecordEventInput
): Promise<{ success: boolean; event?: PortableReputationEvent; error?: string }> {
  if (!isValidDid(input.did)) return { success: false, error: 'Invalid did' };
  if (!isValidDid(input.source_did)) return { success: false, error: 'Invalid source_did' };
  if (!input.event_type) return { success: false, error: 'Missing event_type' };

  const event_id = input.event_id ?? randomUUID();
  const created_at = input.created_at ?? new Date().toISOString();
  const payload: SignablePayload = {
    event_id,
    did: input.did,
    source_did: input.source_did,
    event_type: input.event_type,
    category: input.category ?? null,
    weight: input.weight ?? 0,
    metadata: input.metadata ?? {},
    created_at,
  };
  const signature = signEvent(payload);

  const { data, error } = await supabase
    .from('did_reputation_events')
    .insert({
      ...payload,
      source_rail: input.source_rail ?? null,
      related_transaction_id: input.related_transaction_id ?? null,
      signature,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, event: data as PortableReputationEvent };
}

export interface QueryOpts {
  since?: string;
  source_did?: string;
  event_type?: string;
  category?: string;
  limit?: number;
}

export async function getReputationEvents(
  supabase: SupabaseClient,
  did: string,
  opts: QueryOpts = {}
): Promise<{ events: PortableReputationEvent[]; tampered: PortableReputationEvent[] }> {
  let q = supabase
    .from('did_reputation_events')
    .select('*')
    .eq('did', did)
    .order('created_at', { ascending: false });

  if (opts.since) q = q.gte('created_at', opts.since);
  if (opts.source_did) q = q.eq('source_did', opts.source_did);
  if (opts.event_type) q = q.eq('event_type', opts.event_type);
  if (opts.category) q = q.eq('category', opts.category);
  if (opts.limit) q = q.limit(opts.limit);

  const { data } = await q;
  const rows = (data ?? []) as PortableReputationEvent[];

  const events: PortableReputationEvent[] = [];
  const tampered: PortableReputationEvent[] = [];
  for (const row of rows) {
    // Legacy rows (pre-signing) lack signature/event_id/source_did — pass through unverified.
    if (!row.signature || !row.event_id || !row.source_did) {
      events.push(row);
      continue;
    }
    if (verifyEventSignature(row)) events.push(row);
    else tampered.push(row);
  }
  return { events, tampered };
}
