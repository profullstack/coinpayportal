import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { authorizeBusinessOwner } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { getStripe } from '@/lib/server/optional-deps';

// Dispute states in which accepting (conceding) is still possible. Once a
// dispute is won/lost/closed, there is nothing left to accept.
const ACTIONABLE_DISPUTE_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
]);

/**
 * POST /api/stripe/disputes/[id]/accept
 * Accept (concede) a card dispute via `stripe.disputes.close`. Conceding leaves
 * the funds with the cardholder and stops the dispute process. This is the
 * money-out resolution — you cannot "refund" an already-disputed charge.
 *
 * Owner-only (`funds.move`).
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

    const { data: dispute, error: disputeError } = await supabase
      .from('stripe_disputes')
      .select('id, merchant_id, stripe_dispute_id, stripe_charge_id, status')
      .eq('id', id)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    // Authorize: derive the owning business from the disputed charge and require
    // `funds.move` (owner). If the charge can't be mapped to a transaction, fall
    // back to the dispute owner acting on their own records.
    let authorized = false;
    if (dispute.stripe_charge_id) {
      const { data: tx } = await supabase
        .from('stripe_transactions')
        .select('business_id')
        .eq('stripe_charge_id', dispute.stripe_charge_id)
        .maybeSingle();
      if (tx?.business_id) {
        const authz = await authorizeBusinessOwner(
          supabase,
          decoded.userId,
          tx.business_id,
          'funds.move'
        );
        if (!authz.ok) {
          return NextResponse.json(
            { success: false, error: authz.status === 404 ? 'Dispute not found' : authz.error },
            { status: authz.status }
          );
        }
        authorized = true;
      }
    }
    if (!authorized && dispute.merchant_id !== decoded.userId) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    if (!dispute.stripe_dispute_id) {
      return NextResponse.json(
        { success: false, error: 'Dispute has no Stripe reference' },
        { status: 409 }
      );
    }

    if (!ACTIONABLE_DISPUTE_STATUSES.has(String(dispute.status))) {
      return NextResponse.json(
        { success: false, error: `Dispute can no longer be accepted (status: ${dispute.status})` },
        { status: 409 }
      );
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

    let closed;
    try {
      closed = await stripe.disputes.close(dispute.stripe_dispute_id);
    } catch (stripeError) {
      const message =
        stripeError instanceof Error ? stripeError.message : 'Stripe dispute close failed';
      console.error('Stripe dispute close error:', message);
      return NextResponse.json(
        { success: false, error: message },
        { status: 502 }
      );
    }

    const newStatus = closed?.status || 'lost';
    const { error: updateError } = await supabase
      .from('stripe_disputes')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', dispute.id);

    if (updateError) {
      console.error('Dispute accepted but status update failed:', updateError);
    }

    return NextResponse.json({
      success: true,
      dispute: { id: dispute.id, status: newStatus },
    });
  } catch (error) {
    console.error('Accept dispute error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
