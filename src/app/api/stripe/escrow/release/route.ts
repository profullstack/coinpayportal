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
    const { escrowId, reason = 'Escrow released by merchant' } = await request.json();

    if (!escrowId) {
      return NextResponse.json({ error: 'escrowId is required' }, { status: 400 });
    }

    // Get escrow record
    const { data: escrow } = await supabase
      .from('stripe_escrows')
      .select(`
        *,
        stripe_accounts!inner(stripe_account_id)
      `)
      .eq('id', escrowId)
      .eq('status', 'funded')
      .single();

    if (!escrow) {
      return NextResponse.json(
        { error: 'Escrow not found or not in funded status' },
        { status: 404 }
      );
    }

    // Check if release time has passed (optional auto-release logic)
    const now = new Date();
    const releaseAfter = new Date(escrow.release_after);
    const canRelease = now >= releaseAfter;

    if (!canRelease) {
      return NextResponse.json(
        { error: 'Escrow not yet eligible for release' },
        { status: 400 }
      );
    }

    // Transfer funds to merchant
    const transfer = await getStripe().transfers.create({
      amount: escrow.releasable_amount,
      currency: 'usd', // TODO: Make this dynamic based on original payment
      destination: escrow.stripe_accounts.stripe_account_id,
      metadata: {
        escrow_id: escrowId,
        reason,
      },
    });

    // Update escrow status
    await supabase
      .from('stripe_escrows')
      .update({
        status: 'released',
        updated_at: new Date().toISOString(),
      })
      .eq('id', escrowId);

    // Create DID reputation event for successful escrow release
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
          event_type: 'card_escrow_release',
          source_rail: 'card',
          related_transaction_id: escrow.stripe_payment_intent_id,
          weight: 15, // Positive weight for successful escrow completion
          metadata: {
            escrow_id: escrowId,
            amount: escrow.releasable_amount,
            transfer_id: transfer.id,
            reason,
          },
        });
    }

    return NextResponse.json({
      success: true,
      transfer_id: transfer.id,
      amount_transferred: escrow.releasable_amount,
      destination_account: escrow.stripe_accounts.stripe_account_id,
    });

  } catch (error: any) {
    console.error('Escrow release error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to release escrow' },
      { status: 500 }
    );
  }
}