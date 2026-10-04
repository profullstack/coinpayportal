import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeInvoice } from '@/lib/auth/invoice-access';
import { deliverInvoiceEmail, getInvoicePaymentLink } from '@/lib/email/invoice-delivery';
import { activateInvoicePayment } from '@/lib/invoices/activation';

/**
 * POST /api/invoices/[id]/send
 * Send an invoice to the client via email
 * - Calculates crypto_amount from current exchange rate
 * - Generates system intermediary payment address
 * - Sends email with payment link
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // Authorize by the invoice's business (team members included), then load it
    // with client + business info.
    const access = await authorizeInvoice(
      supabase,
      request,
      id,
      'invoice.write',
      `
        *,
        clients (id, name, email, company_name),
        businesses (id, name, merchant_id)
      `,
    );
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    const { invoice } = access;

    if (invoice.status !== 'draft' && invoice.status !== 'overdue') {
      return NextResponse.json({ success: false, error: `Cannot send invoice with status: ${invoice.status}` }, { status: 400 });
    }

    if (!invoice.crypto_currency) {
      return NextResponse.json({ success: false, error: 'Crypto currency must be set before sending' }, { status: 400 });
    }

    const clientEmail = invoice.clients?.email;
    if (!clientEmail) {
      return NextResponse.json({ success: false, error: 'Client email is required to send invoice' }, { status: 400 });
    }

    const activation = await activateInvoicePayment(supabase, invoice);
    if (!activation.ok) {
      return NextResponse.json(
        { success: false, error: activation.error, code: activation.code },
        { status: activation.status }
      );
    }

    const updatedInvoice = activation.invoice;
    const cryptoAmount = Number(updatedInvoice.crypto_amount || 0);
    const emailAttemptedAt = new Date().toISOString();

    // Keep delivery tracking separate from the payment commit. This preserves
    // the live invoice if application code is deployed before the migration or
    // if observability storage is temporarily unavailable.
    const pendingEmailState = {
      email_status: 'pending',
      email_message_id: null,
      email_last_error: null,
      email_last_attempted_at: emailAttemptedAt,
    };
    const { data: pendingTrackedInvoice, error: pendingTrackingError } = await supabase
      .from('invoices')
      .update(pendingEmailState)
      .eq('id', id)
      .select('id')
      .maybeSingle();

    const pendingTrackingSaved = !pendingTrackingError && !!pendingTrackedInvoice;

    if (!pendingTrackingSaved) {
      console.error('Failed to record invoice email attempt:', {
        invoiceId: invoice.id,
        error: pendingTrackingError || 'Invoice changed before the email attempt could be tracked',
      });
    }

    let emailResult;
    try {
      emailResult = await deliverInvoiceEmail({
        ...updatedInvoice,
        crypto_amount: cryptoAmount.toFixed(8),
        crypto_currency: invoice.crypto_currency,
        clients: invoice.clients,
        businesses: invoice.businesses,
      });
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

    let emailTrackingError: unknown = pendingTrackingError;
    let emailTrackingSaved = false;
    if (pendingTrackingSaved) {
      const { data: finalizedEmailAttempt, error: finalTrackingError } = await supabase
        .from('invoices')
        .update(emailState)
        .eq('id', id)
        .eq('email_last_attempted_at', emailAttemptedAt)
        .select('id')
        .maybeSingle();

      emailTrackingError = finalTrackingError || (!finalizedEmailAttempt
        ? 'A newer invoice email attempt replaced this tracking state'
        : null);
      emailTrackingSaved = !emailTrackingError && !!finalizedEmailAttempt;
    }

    if (!emailResult.success) {
      console.error('Invoice email was not accepted by the provider:', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        error: emailResult.error,
      });
    }
    if (!emailTrackingSaved) {
      console.error('Failed to persist invoice email status:', {
        invoiceId: invoice.id,
        error: emailTrackingError,
      });
    }

    const warning = !emailResult.success
      ? 'The payment link is active, but the email provider did not accept the message. Copy the payment link or retry the email.'
      : !emailTrackingSaved
        ? 'The email provider accepted the message, but its tracking status could not be saved.'
        : undefined;
    const persistedInvoice = !emailTrackingSaved
      ? {
          ...updatedInvoice,
          ...(pendingTrackingSaved && pendingEmailState),
        }
      : { ...updatedInvoice, ...emailState };

    return NextResponse.json({
      success: true,
      invoice: persistedInvoice,
      emailAccepted: emailResult.success,
      emailTrackingSaved,
      paymentLink: emailResult.paymentLink,
      ...(warning && { warning }),
      ...(!emailResult.success && { emailError: emailResult.error }),
    });
  } catch (error) {
    console.error('Send invoice error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
