import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/lib/auth/jwt';
import { authorizeBusinessOwner } from '@/lib/auth/authz';
import { getJwtSecret } from '@/lib/secrets';
import { refundPaypalCapture } from '@/lib/paypal/client';
import { resolvePaypalContext } from '@/lib/paypal/accounts';

/** Only a settled capture can be reversed. */
const REFUNDABLE_STATUSES = new Set(['completed', 'partially_refunded']);

/**
 * POST /api/paypal/transactions/[id]/refund
 *
 * Refund a PayPal transaction — the analogue of
 * POST /api/stripe/transactions/[id]/refund. Owner-only (`funds.move`), because
 * it moves money back out of the merchant's balance.
 *
 * Body: `{ amount?: number }` in MAJOR units. Omit for a full refund.
 *
 * On a partner order PayPal proportionally reverses the platform fee along with
 * the payment, so CoinPay's commission unwinds automatically — there is no
 * `refund_application_fee` flag to set as there is on Stripe. The authoritative
 * refunded totals arrive on the PAYMENT.CAPTURE.REFUNDED webhook; what this
 * route writes is the optimistic view so the dashboard updates immediately.
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

    const { data: transaction, error: txError } = await supabase
      .from('paypal_transactions')
      .select(
        'id, business_id, status, amount, currency, paypal_capture_id, refunded_amount, invoice_number'
      )
      .eq('id', id)
      .single();

    if (txError || !transaction) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
    }

    const authz = await authorizeBusinessOwner(
      supabase,
      decoded.userId,
      transaction.business_id,
      'funds.move'
    );
    if (!authz.ok) {
      // Don't leak existence to non-members.
      return NextResponse.json(
        { success: false, error: authz.status === 404 ? 'Transaction not found' : authz.error },
        { status: authz.status }
      );
    }

    if (transaction.status === 'refunded') {
      return NextResponse.json(
        { success: false, error: 'Transaction already fully refunded' },
        { status: 409 }
      );
    }

    if (!REFUNDABLE_STATUSES.has(String(transaction.status))) {
      return NextResponse.json(
        { success: false, error: `Cannot refund a ${transaction.status} transaction` },
        { status: 409 }
      );
    }

    if (!transaction.paypal_capture_id) {
      return NextResponse.json(
        { success: false, error: 'Transaction has no PayPal capture to refund' },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const original = Number(transaction.amount ?? 0);
    const alreadyRefunded = Number(transaction.refunded_amount ?? 0);
    const remaining = Math.round((original - alreadyRefunded) * 100) / 100;

    let refundAmount: number | null = null;
    if (body.amount !== undefined && body.amount !== null) {
      const requested = Math.round(Number(body.amount) * 100) / 100;
      if (!Number.isFinite(requested) || requested <= 0) {
        return NextResponse.json(
          { success: false, error: 'amount must be a positive number' },
          { status: 400 }
        );
      }
      if (requested > remaining) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot refund ${requested} — only ${remaining} of this payment remains unrefunded`,
          },
          { status: 400 }
        );
      }
      refundAmount = requested;
    }

    const context = await resolvePaypalContext(supabase, transaction.business_id);
    if ('error' in context) {
      return NextResponse.json({ success: false, error: context.error }, { status: context.status });
    }

    let refund;
    try {
      refund = await refundPaypalCapture({
        ...context.creds,
        ...context.callContext,
        captureId: transaction.paypal_capture_id,
        amount: refundAmount,
        currency: transaction.currency || 'USD',
        invoiceId: transaction.invoice_number || undefined,
        noteToPayer: 'Refund issued by the merchant.',
      });
    } catch (err) {
      console.error('[PayPal] Refund failed:', err);
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'PayPal refund failed' },
        { status: 502 }
      );
    }

    // PayPal can return PENDING for a refund it has accepted but not settled.
    // Treat anything that is not an outright failure as issued and let the
    // webhook correct the totals.
    const settledAmount = refundAmount ?? remaining;
    const totalRefunded = Math.round((alreadyRefunded + settledAmount) * 100) / 100;
    const newStatus = totalRefunded >= original ? 'refunded' : 'partially_refunded';

    const { error: updateError } = await supabase
      .from('paypal_transactions')
      .update({
        status: newStatus,
        refunded_amount: totalRefunded,
        paypal_refund_id: refund.refundId || null,
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id);

    if (updateError) {
      // The money HAS moved at PayPal. Say so rather than reporting a failure
      // that would invite the merchant to refund again.
      console.error('[PayPal] Refund succeeded but the row update failed:', updateError);
      return NextResponse.json(
        {
          success: true,
          warning:
            'The refund was issued at PayPal but could not be recorded locally. The webhook will reconcile it.',
          refund_id: refund.refundId,
          status: refund.status,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      refund_id: refund.refundId,
      status: newStatus,
      paypal_status: refund.status,
      refunded_amount: totalRefunded,
      remaining: Math.round((original - totalRefunded) * 100) / 100,
      currency: transaction.currency || 'USD',
    });
  } catch (error) {
    console.error('PayPal refund route error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
