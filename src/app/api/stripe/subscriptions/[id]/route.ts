import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';
import Stripe from 'stripe';

let _stripe: Stripe;
function getStripe() {
  return (_stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover' as const,
  }));
}

/**
 * GET /api/stripe/subscriptions/[id]
 * Get subscription details
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    let decoded;
    try { decoded = verifyToken(authHeader.substring(7), jwtSecret); }
    catch { return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 }); }

    const merchantId = decoded.userId;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('*, subscription_plans(name, amount, currency, interval)')
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !subscription) {
      return NextResponse.json({ success: false, error: 'Subscription not found' }, { status: 404 });
    }

    // If there's a Stripe subscription ID, fetch latest status from Stripe
    if (subscription.stripe_subscription_id) {
      try {
        const stripeSub = await getStripe().subscriptions.retrieve(
          subscription.stripe_subscription_id,
          { stripeAccount: subscription.stripe_account_id }
        );
        
        // Update local status if changed
        if (stripeSub.status !== subscription.status) {
          await supabase
            .from('subscriptions')
            .update({ status: stripeSub.status, updated_at: new Date().toISOString() })
            .eq('id', id);
          subscription.status = stripeSub.status;
        }

        const sub = stripeSub as any;
        subscription.stripe_details = {
          current_period_start: sub.current_period_start,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          canceled_at: sub.canceled_at,
          trial_start: sub.trial_start,
          trial_end: sub.trial_end,
        };
      } catch {
        // Stripe fetch failed, return cached data
      }
    }

    return NextResponse.json({ success: true, subscription });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/stripe/subscriptions/[id]
 * Cancel a subscription
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Missing authorization header' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    let decoded;
    try { decoded = verifyToken(authHeader.substring(7), jwtSecret); }
    catch { return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 }); }

    const merchantId = decoded.userId;
    const body = await request.json().catch(() => ({}));
    const immediately = body.immediately || false;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .single();

    if (!subscription) {
      return NextResponse.json({ success: false, error: 'Subscription not found' }, { status: 404 });
    }

    if (subscription.stripe_subscription_id) {
      const stripe = getStripe();
      if (immediately) {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id, {
          stripeAccount: subscription.stripe_account_id,
        });
      } else {
        await stripe.subscriptions.update(
          subscription.stripe_subscription_id,
          { cancel_at_period_end: true },
          { stripeAccount: subscription.stripe_account_id }
        );
      }
    }

    const newStatus = immediately ? 'canceled' : subscription.status;
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        status: newStatus,
        canceled_at: new Date().toISOString(),
        cancel_at_period_end: !immediately,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: immediately ? 'Subscription canceled immediately' : 'Subscription will cancel at end of billing period',
      status: newStatus,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
