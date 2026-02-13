import type { SupabaseClient } from '@supabase/supabase-js';

export type CardReputationEventType =
  | 'card_payment_success'
  | 'card_refund'
  | 'card_dispute_created'
  | 'card_chargeback_lost';

const EVENT_WEIGHTS: Record<CardReputationEventType, number> = {
  card_payment_success: 1,
  card_refund: -2,
  card_dispute_created: -5,
  card_chargeback_lost: -10,
};

export interface ReputationEventParams {
  did: string;
  eventType: CardReputationEventType;
  relatedTransactionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record a DID reputation event for card activity
 */
export async function recordReputationEvent(
  supabase: SupabaseClient,
  params: ReputationEventParams
) {
  const weight = EVENT_WEIGHTS[params.eventType];

  const { data, error } = await supabase
    .from('did_reputation_events')
    .insert({
      did: params.did,
      event_type: params.eventType,
      source_rail: 'card',
      related_transaction_id: params.relatedTransactionId || null,
      weight,
      metadata: params.metadata || {},
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get reputation summary for a DID (card rail)
 */
export async function getCardReputationSummary(
  supabase: SupabaseClient,
  did: string
) {
  const { data: events, error } = await supabase
    .from('did_reputation_events')
    .select('event_type, weight')
    .eq('did', did)
    .eq('source_rail', 'card');

  if (error) throw error;

  const summary = {
    total_events: events?.length || 0,
    total_score: 0,
    successful_payments: 0,
    refunds: 0,
    disputes: 0,
    chargebacks_lost: 0,
  };

  for (const event of events || []) {
    summary.total_score += event.weight;
    switch (event.event_type) {
      case 'card_payment_success': summary.successful_payments++; break;
      case 'card_refund': summary.refunds++; break;
      case 'card_dispute_created': summary.disputes++; break;
      case 'card_chargeback_lost': summary.chargebacks_lost++; break;
    }
  }

  const totalTxns = summary.successful_payments + summary.refunds;
  summary.total_score = summary.total_score; // keep as computed
  return {
    ...summary,
    dispute_ratio: totalTxns > 0 ? summary.disputes / totalTxns : 0,
    refund_ratio: totalTxns > 0 ? summary.refunds / totalTxns : 0,
  };
}
