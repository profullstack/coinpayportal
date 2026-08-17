import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeInvoice } from '@/lib/auth/invoice-access';
import { deliverInvoiceEmail, getInvoicePaymentLink } from '@/lib/email/invoice-delivery';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';

/**
 * POST /api/invoices/[id]/resend-email
 * Retry only the invoice notification. The existing payment address and payment
 * methods are reused; this route never creates or replaces a payment resource.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const access = await authorizeInvoice(
      supabase,
      request,
      id,
      'invoice.write',
      `
        *,
        clients (id, name, email, company_name),
        businesses (id, name)
      `,
    );

    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const { invoice } = access;
    if (invoice.status !== 'sent') {
      return NextResponse.json(
        { success: false, error: `Cannot resend email for invoice with status: ${invoice.status}` },
        { status: 400 }
      );
    }
    if (!invoice.clients?.email) {
      return NextResponse.json(
        { success: false, error: 'Client email is required to resend invoice' },
        { status: 400 }
      );
    }
    if (!invoice.crypto_currency || !invoice.crypto_amount || !invoice.payment_address) {
      return NextResponse.json(
        { success: false, error: 'Invoice payment details are incomplete' },
        { status: 400 }
      );
    }

    // A legacy invoice may predate coinpay_payment_id metadata, so fall back to
    // its payment address. In both cases, only re-advertise a payment that the
    // normal monitor is still watching.
    const metadata = invoice.metadata && typeof invoice.metadata === 'object'
      ? invoice.metadata as Record<string, unknown>
      : {};
    const linkedPaymentId = typeof metadata.coinpay_payment_id === 'string'
      ? metadata.coinpay_payment_id
      : null;
    let paymentLookup = supabase
      .from('payments')
      .select('id, business_id, payment_address, status, expires_at')
      .eq('business_id', invoice.business_id);

    paymentLookup = linkedPaymentId
      ? paymentLookup.eq('id', linkedPaymentId)
      : paymentLookup
          .eq('payment_address', invoice.payment_address)
          .order('created_at', { ascending: false })
          .limit(1);

    const { data: linkedPayment, error: paymentLookupError } = await paymentLookup.maybeSingle();
    if (paymentLookupError) {
      console.error('Failed to verify invoice payment before email retry:', {
        invoiceId: invoice.id,
        error: paymentLookupError,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to verify the existing invoice payment' },
        { status: 500 }
      );
    }

    const paymentExpiresAt = linkedPayment?.expires_at
      ? new Date(linkedPayment.expires_at).getTime()
      : 0;
    const paymentMatchesInvoice = linkedPayment?.payment_address === invoice.payment_address;
    const paymentStatus = typeof linkedPayment?.status === 'string'
      ? linkedPayment.status
      : null;
    const paymentIsActive = paymentStatus === 'pending'
      && paymentMatchesInvoice
      && paymentExpiresAt > Date.now();

    if (linkedPayment && !paymentMatchesInvoice) {
      return NextResponse.json(
        {
          success: false,
          code: 'PAYMENT_LINK_MISMATCH',
          error: 'The linked payment does not match this invoice. Review the payment before retrying or re-issuing it.',
          canReissue: false,
        },
        { status: 409 }
      );
    }

    const paymentAlreadyDetected = paymentStatus
      ? ['confirmed', 'forwarding', 'forwarded', 'forwarding_failed'].includes(paymentStatus)
      : false;
    if (paymentAlreadyDetected) {
      return NextResponse.json(
        {
          success: false,
          code: 'PAYMENT_ALREADY_DETECTED',
          error: 'Payment has already been detected for this invoice. Wait for settlement or reconcile the payment before sending another request.',
          canReissue: false,
        },
        { status: 409 }
      );
    }

    const paymentIsDead = !linkedPayment
      || (paymentStatus === 'pending' && paymentExpiresAt <= Date.now())
      || (paymentStatus ? ['expired', 'cancelled', 'failed'].includes(paymentStatus) : false);

    if (!paymentIsActive && !paymentIsDead) {
      return NextResponse.json(
        {
          success: false,
          code: 'PAYMENT_STATUS_UNRESOLVED',
          error: 'The existing payment is not in a state that can be emailed or re-issued safely.',
          canReissue: false,
        },
        { status: 409 }
      );
    }

    if (!paymentIsActive) {
      // Keep the invoice state aligned with the payment state. Without a due
      // date, the monitor cannot promote a legacy sent invoice to overdue, so
      // the UI would otherwise keep offering only a retry that can never work.
      // The conditional update also avoids overwriting a concurrent settlement.
      const updatedAt = new Date().toISOString();
      const { data: reissuableInvoice, error: reissueStateError } = await supabase
        .from('invoices')
        .update({ status: 'overdue', updated_at: updatedAt })
        .eq('id', id)
        .eq('status', 'sent')
        .select('id')
        .maybeSingle();

      if (reissueStateError) {
        console.error('Failed to mark invoice ready for payment re-issue:', {
          invoiceId: id,
          error: reissueStateError,
        });
        return NextResponse.json(
          { success: false, error: 'The payment link is inactive, but the invoice could not be prepared for re-issue.' },
          { status: 500 }
        );
      }
      if (!reissuableInvoice) {
        return NextResponse.json(
          { success: false, error: 'The invoice changed while its payment link was being checked.' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          code: 'PAYMENT_LINK_INACTIVE',
          error: 'The existing payment link is no longer active. Re-issue the invoice before emailing it again.',
          canReissue: true,
          invoice: { ...invoice, status: 'overdue', updated_at: updatedAt },
        },
        { status: 409 }
      );
    }

    const resendRate = await checkRateLimitAsync(invoice.business_id, 'invoice_email_resend');
    if (!resendRate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many invoice email attempts; try again shortly.' },
        { status: 429 }
      );
    }

    const lastAttemptAt = invoice.email_last_attempted_at
      ? new Date(invoice.email_last_attempted_at).getTime()
      : 0;
    if (invoice.email_status === 'pending' && lastAttemptAt > Date.now() - 2 * 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'An invoice email attempt is already in progress.' },
        { status: 409 }
      );
    }

    const emailAttemptedAt = new Date().toISOString();
    let pendingUpdate = supabase
      .from('invoices')
      .update({
        email_status: 'pending',
        email_message_id: null,
        email_last_error: null,
        email_last_attempted_at: emailAttemptedAt,
      })
      .eq('id', id)
      .eq('status', 'sent');

    pendingUpdate = invoice.email_last_attempted_at
      ? pendingUpdate.eq('email_last_attempted_at', invoice.email_last_attempted_at)
      : pendingUpdate.is('email_last_attempted_at', null);

    const { data: claimedInvoice, error: pendingError } = await pendingUpdate
      .select('id')
      .maybeSingle();

    if (pendingError) {
      console.error('Failed to start invoice email retry:', { invoiceId: id, error: pendingError });
      return NextResponse.json(
        { success: false, error: 'Failed to start invoice email retry' },
        { status: 500 }
      );
    }
    if (!claimedInvoice) {
      return NextResponse.json(
        { success: false, error: 'The invoice changed or another email attempt already started.' },
        { status: 409 }
      );
    }

    let emailResult;
    try {
      emailResult = await deliverInvoiceEmail(invoice);
    } catch (emailError) {
      emailResult = {
        success: false,
        error: emailError instanceof Error ? emailError.message : 'Email provider failed unexpectedly',
        paymentLink: getInvoicePaymentLink(invoice.id),
      };
    }

    const emailState = {
      email_status: emailResult.success ? 'accepted' : 'failed',
      email_message_id: emailResult.messageId || null,
      email_last_error: emailResult.success ? null : (emailResult.error || 'Email provider rejected the message'),
      email_last_attempted_at: emailAttemptedAt,
    };
    const { data: finalizedEmailAttempt, error: trackingError } = await supabase
      .from('invoices')
      .update(emailState)
      .eq('id', id)
      .eq('email_last_attempted_at', emailAttemptedAt)
      .select('id')
      .maybeSingle();

    const emailTrackingSaved = !trackingError && !!finalizedEmailAttempt;

    if (!emailTrackingSaved) {
      console.error('Failed to persist invoice email retry status:', {
        invoiceId: invoice.id,
        error: trackingError || 'A newer invoice email attempt replaced this tracking state',
      });
    }

    const warning = !emailResult.success
      ? 'The existing payment link is still active, but the email provider did not accept the message.'
      : !emailTrackingSaved
        ? 'The email provider accepted the message, but its tracking status could not be saved.'
        : undefined;
    const persistedEmailState = !emailTrackingSaved
      ? {
          email_status: 'pending',
          email_message_id: null,
          email_last_error: null,
          email_last_attempted_at: emailAttemptedAt,
        }
      : emailState;

    const responseBody = {
      success: true,
      invoice: { ...invoice, ...persistedEmailState },
      emailAccepted: emailResult.success,
      emailTrackingSaved,
      paymentLink: emailResult.paymentLink,
      ...(warning && { warning }),
      ...(!emailResult.success && { emailError: emailResult.error }),
    };

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('Resend invoice email error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
