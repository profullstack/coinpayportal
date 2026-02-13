import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

let _stripe: Stripe;
function getStripe() {
  return (_stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover' as const,
  }));
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { escrowId, reason = 'Escrow refunded', amount } = await request.json();

    if (!escrowId) {
      return NextResponse.json({ error: 'escrowId is required' }, { status: 400 });
    }

    // Get escrow record
    const { data: escrow } = await supabase
      .from('stripe_escrows')
      .select('*')
      .eq('id', escrowId)
      .eq('status', 'funded')
      .single();

    if (!escrow) {
      return NextResponse.json(
        { error: 'Escrow not found or not in funded status' },
        { status: 404 }
      );
    }

    // Get the charge to refund
    if (!escrow.stripe_charge_id) {
      return NextResponse.json(
        { error: 'No charge ID found for escrow' },
        { status: 400 }
      );
    }

    // Calculate refund amount (partial or full)
    const refundAmount = amount || escrow.total_amount;
    
    if (refundAmount > escrow.total_amount) {
      return NextResponse.json(
        { error: 'Refund amount cannot exceed total escrow amount' },
        { status: 400 }
      );
    }

    // Create refund
    const refund = await getStripe().refunds.create({
      charge: escrow.stripe_charge_id,
      amount: refundAmount,
      reason: 'requested_by_customer',
      metadata: {
        escrow_id: escrowId,
        reason,
      },
    });

    // Update escrow status
    const newStatus = refundAmount === escrow.total_amount ? 'refunded' : 'partially_refunded';
    
    await supabase
      .from('stripe_escrows')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId);

    // Create DID reputation event for refund
    const { data: merchant } = await supabase
      .from('merchants')
      .select('did')
      .eq('id', escrow.merchant_id)
      .single();

    if (merchant?.did) {
      await supabase
        .from('did_reputation_events')
        .insert({
          did: merchant.did,
          event_type: 'card_refund',
          source_rail: 'card',
          related_transaction_id: escrow.stripe_payment_intent_id,
          weight: -25, // Negative weight for refund
          metadata: {
            escrow_id: escrowId,
            refund_id: refund.id,
            amount: refundAmount,
            reason,
            partial: refundAmount < escrow.total_amount,
          },
        });
    }

    return NextResponse.json({
      success: true,
      refund_id: refund.id,
      amount_refunded: refundAmount,
      status: refund.status,
      escrow_status: newStatus,
    });

  } catch (error: any) {
    console.error('Escrow refund error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to refund escrow' },
      { status: 500 }
    );
  }
}