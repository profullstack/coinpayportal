import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripeClient } from './client';

export interface CreateEscrowRecordParams {
  merchantId: string;
  stripePaymentIntentId: string;
  stripeChargeId?: string;
  totalAmount: number;
  platformFee: number;
  stripeFee: number;
  releaseAfterDays: number;
}

/**
 * Create an escrow record in the database
 */
export async function createEscrowRecord(
  supabase: SupabaseClient,
  params: CreateEscrowRecordParams
) {
  const releasableAmount = params.totalAmount - params.platformFee - params.stripeFee;
  const releaseAfter = new Date();
  releaseAfter.setDate(releaseAfter.getDate() + params.releaseAfterDays);

  const { data, error } = await supabase
    .from('stripe_escrows')
    .insert({
      merchant_id: params.merchantId,
      stripe_payment_intent_id: params.stripePaymentIntentId,
      stripe_charge_id: params.stripeChargeId || null,
      total_amount: params.totalAmount,
      platform_fee: params.platformFee,
      stripe_fee: params.stripeFee,
      releasable_amount: releasableAmount,
      status: 'held',
      release_after: releaseAfter.toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Release escrow — transfer funds to merchant's Stripe connected account
 */
export async function releaseEscrow(
  supabase: SupabaseClient,
  escrowId: string,
  stripeAccountId: string
) {
  // Get escrow record
  const { data: escrow, error: fetchError } = await supabase
    .from('stripe_escrows')
    .select('*')
    .eq('id', escrowId)
    .eq('status', 'held')
    .single();

  if (fetchError || !escrow) {
    throw new Error('Escrow not found or already released');
  }

  // Create Stripe transfer
  const stripe = getStripeClient();
  const transfer = await stripe.transfers.create({
    amount: escrow.releasable_amount,
    currency: escrow.currency || 'usd',
    destination: stripeAccountId,
    metadata: {
      escrow_id: escrowId,
      coinpay_merchant_id: escrow.merchant_id,
    },
  });

  // Update escrow status
  const { data, error: updateError } = await supabase
    .from('stripe_escrows')
    .update({
      status: 'released',
      released_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', escrowId)
    .select()
    .single();

  if (updateError) throw updateError;
  return { escrow: data, transfer };
}

/**
 * Auto-release escrows that have passed their release_after date
 */
export async function autoReleaseEscrows(supabase: SupabaseClient) {
  const { data: dueEscrows, error } = await supabase
    .from('stripe_escrows')
    .select('*, stripe_accounts!inner(stripe_account_id)')
    .eq('status', 'held')
    .lte('release_after', new Date().toISOString());

  if (error) throw error;
  if (!dueEscrows?.length) return [];

  const results = [];
  for (const escrow of dueEscrows) {
    try {
      const result = await releaseEscrow(
        supabase,
        escrow.id,
        escrow.stripe_accounts.stripe_account_id
      );
      results.push({ escrowId: escrow.id, success: true, result });
    } catch (err) {
      results.push({ escrowId: escrow.id, success: false, error: err });
    }
  }
  return results;
}
