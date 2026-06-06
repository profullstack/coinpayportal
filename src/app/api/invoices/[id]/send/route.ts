import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMerchant } from '@/lib/auth/merchant';
import { createPayment, type Blockchain } from '@/lib/payments/service';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { sendEmail } from '@/lib/email';
import { invoiceSentTemplate } from '@/lib/email/invoice-templates';
import { getStripe } from '@/lib/server/optional-deps';

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
    const authResult = await resolveMerchant(supabase, request);
    if ('error' in authResult) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    const { merchantId } = authResult;

    // Get the invoice with client and business info
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name, merchant_id)
      `)
      .eq('id', id)
      .eq('user_id', merchantId)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 });
    }

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

    const isPaidTier = await isBusinessPaidTier(supabase, invoice.business_id);

    // Create a normal CoinPay payment so invoices use the same intermediary
    // payment address, tiered commission, and secure forwarding path as /payments.
    const paymentResult = await createPayment(supabase, {
      business_id: invoice.business_id,
      amount: parseFloat(invoice.amount),
      currency: invoice.currency || 'USD',
      blockchain: invoice.crypto_currency as Blockchain,
      merchant_wallet_address: invoice.merchant_wallet_address || '',
      metadata: {
        ...(invoice.metadata && typeof invoice.metadata === 'object' ? invoice.metadata : {}),
        source: 'invoice',
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
      },
    });

    if (!paymentResult.success || !paymentResult.payment?.payment_address) {
      return NextResponse.json(
        { success: false, error: `Failed to create invoice payment: ${paymentResult.error || 'No payment address generated'}` },
        { status: 500 }
      );
    }

    const coinpayPayment = paymentResult.payment;
    const cryptoAmount = Number(coinpayPayment.crypto_amount || 0);

    // Calculate fee amount
    const feeAmount = parseFloat(invoice.amount) * parseFloat(invoice.fee_rate);

    // Try to create Stripe Checkout Session if business has stripe connected account
    let stripeCheckoutUrl: string | null = null;
    let stripeSessionId: string | null = null;

    try {
      const { data: stripeAccount } = await supabase
        .from('stripe_accounts')
        .select('stripe_account_id, charges_enabled')
        .eq('business_id', invoice.business_id)
        .single();

      if (stripeAccount?.stripe_account_id && stripeAccount.charges_enabled) {
        const amountCents = Math.round(parseFloat(invoice.amount) * 100);
        const platformFeeRate = isPaidTier ? 0.005 : 0.01;
        const platformFeeAmount = Math.round(amountCents * platformFeeRate);

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
        const stripe = await getStripe();
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: { name: `Invoice ${invoice.invoice_number}` },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          payment_intent_data: {
            application_fee_amount: platformFeeAmount,
            transfer_data: {
              destination: stripeAccount.stripe_account_id,
            },
            metadata: {
              coinpay_invoice_id: invoice.id,
              business_id: invoice.business_id,
              merchant_id: invoice.businesses?.merchant_id,
            },
          },
          success_url: `${appUrl}/invoices/${invoice.id}/pay?status=success`,
          cancel_url: `${appUrl}/invoices/${invoice.id}/pay`,
          metadata: {
            coinpay_invoice_id: invoice.id,
            business_id: invoice.business_id,
            merchant_id: invoice.businesses?.merchant_id,
            platform_fee_amount: platformFeeAmount.toString(),
          },
        });

        stripeCheckoutUrl = session.url!;
        stripeSessionId = session.id;
      }
    } catch (stripeError) {
      // Stripe session creation is optional - don't fail the entire send
      console.error('Failed to create Stripe checkout session for invoice:', stripeError);
    }

    // Update invoice
    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'sent',
        crypto_amount: cryptoAmount.toFixed(8),
        payment_address: coinpayPayment.payment_address,
        fee_amount: feeAmount,
        metadata: {
          ...(invoice.metadata && typeof invoice.metadata === 'object' ? invoice.metadata : {}),
          coinpay_payment_id: coinpayPayment.id,
        },
        ...(stripeCheckoutUrl && { stripe_checkout_url: stripeCheckoutUrl }),
        ...(stripeSessionId && { stripe_session_id: stripeSessionId }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`*, clients (id, name, email, company_name), businesses (id, name)`)
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: 'Failed to update invoice' }, { status: 500 });
    }

    // Send email to client
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
    const paymentLink = `${appUrl}/invoices/${invoice.id}/pay`;

    const businessName = invoice.businesses?.name || 'CoinPay Merchant';
    const template = invoiceSentTemplate({
      invoiceNumber: invoice.invoice_number,
      amount: parseFloat(invoice.amount),
      currency: invoice.currency || 'USD',
      cryptoAmount: cryptoAmount.toFixed(8),
      cryptoCurrency: invoice.crypto_currency,
      dueDate: invoice.due_date,
      businessName,
      paymentLink,
      notes: invoice.notes,
    });

    await sendEmail({
      to: clientEmail,
      subject: template.subject,
      html: template.html,
    });

    return NextResponse.json({ success: true, invoice: updatedInvoice });
  } catch (error) {
    console.error('Send invoice error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
