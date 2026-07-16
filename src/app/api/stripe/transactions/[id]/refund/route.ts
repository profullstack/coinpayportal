import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { authorizeBusinessOwner } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { getStripe } from '@/lib/server/optional-deps';

// A card transaction can only be refunded from a settled, successful state.
const REFUNDABLE_STATUSES = new Set(['succeeded', 'completed']);
// Dispute states that mean the charge is still contested — you cannot refund a
// charge with an open dispute; the merchant must accept/contest the dispute.
const OPEN_DISPUTE_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
]);

/**
 * POST /api/stripe/transactions/[id]/refund
 * Refund a card (Stripe Connect) transaction. Card charges are destination
 * charges on the platform account, so the refund is issued on the platform
 * client with `reverse_transfer`/`refund_application_fee` so the funds (and the
 * platform fee) are pulled back from the connected account.
 *
 * Owner-only (`funds.move`). Refusing when the charge is disputed — accept the
 * dispute instead.
 */
export async function POST(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let decoded;
    try {
      decoded = verifyToken(authHeader.substring(7), jwtSecret);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load the transaction (service role bypasses RLS; ownership checked below).
    const { data: transaction, error: txError } = await supabase
      .from('stripe_transactions')
      .select(
        'id, business_id, status, amount, currency, stripe_payment_intent_id, stripe_charge_id'
      )
      .eq('id', id)
      .single();

    if (txError || !transaction) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Owner-only: refunding moves funds back out of the merchant's balance.
    const authz = await authorizeBusinessOwner(
      supabase,
      decoded.userId,
      transaction.business_id,
      'funds.move'
    );
    if (!authz.ok) {
      // Don't leak existence to non-members: a 404 authz becomes "not found".
      return NextResponse.json(
        { success: false, error: authz.status === 404 ? 'Transaction not found' : authz.error },
        { status: authz.status }
      );
    }

    if (transaction.status === 'refunded') {
      return NextResponse.json(
        { success: false, error: 'Transaction already refunded' },
        { status: 409 }
      );
    }

    if (!REFUNDABLE_STATUSES.has(String(transaction.status))) {
      return NextResponse.json(
        { success: false, error: `Cannot refund a ${transaction.status} transaction` },
        { status: 409 }
      );
    }

    if (!transaction.stripe_payment_intent_id && !transaction.stripe_charge_id) {
      return NextResponse.json(
        { success: false, error: 'Transaction has no Stripe charge to refund' },
        { status: 409 }
      );
    }

    // Block refunds on charges with an open dispute — Stripe rejects these, and
    // the correct action is to accept/contest the dispute.
    if (transaction.stripe_charge_id) {
      const { data: dispute } = await supabase
        .from('stripe_disputes')
        .select('status')
        .eq('stripe_charge_id', transaction.stripe_charge_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dispute && OPEN_DISPUTE_STATUSES.has(String(dispute.status))) {
        return NextResponse.json(
          {
            success: false,
            error: 'This charge has an open dispute. Resolve the dispute instead of refunding.',
          },
          { status: 409 }
        );
      }
    }

    let stripe;
    try {
      stripe = await getStripe();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Stripe is not configured' },
        { status: 500 }
      );
    }

    // Destination charge: refund on the platform PI and reverse the transfer +
    // application fee so the connected account and platform give back their cut.
    let refund;
    try {
      refund = await stripe.refunds.create({
        ...(transaction.stripe_payment_intent_id
          ? { payment_intent: transaction.stripe_payment_intent_id }
          : { charge: transaction.stripe_charge_id }),
        reverse_transfer: true,
        refund_application_fee: true,
      });
    } catch (stripeError) {
      const message =
        stripeError instanceof Error ? stripeError.message : 'Stripe refund failed';
      console.error('Stripe refund error:', message);
      return NextResponse.json(
        { success: false, error: message },
        { status: 502 }
      );
    }

    const { error: updateError } = await supabase
      .from('stripe_transactions')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', transaction.id);

    if (updateError) {
      // The money moved; surface success but log the bookkeeping miss. The
      // charge.refunded webhook will also reconcile the status.
      console.error('Refund succeeded but status update failed:', updateError);
    }

    return NextResponse.json({
      success: true,
      refund: {
        id: refund.id,
        status: refund.status,
        amount_cents: refund.amount,
        amount_usd: ((refund.amount || 0) / 100).toFixed(2),
        currency: refund.currency,
      },
      transaction_id: transaction.id,
    });
  } catch (error) {
    console.error('Refund transaction error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
