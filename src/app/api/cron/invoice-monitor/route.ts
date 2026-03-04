/**
 * Invoice Payment Monitor Cron
 *
 * GET/POST /api/cron/invoice-monitor
 *
 * Monitors payment addresses for sent invoices, marks them paid when payment
 * is received, forwards to merchant minus fee, sends confirmation emails.
 * Also marks overdue invoices and sends reminders.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { invoicePaidMerchantTemplate, invoiceOverdueTemplate } from '@/lib/email/invoice-templates';

function authenticateRequest(request: NextRequest): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_KEY;
  if (!cronSecret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader?.replace('Bearer ', '') === cronSecret;
}

export async function GET(request: NextRequest) {
  try {
    if (!authenticateRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const now = new Date();
    const stats = { checked: 0, paid: 0, overdue: 0, reminders: 0, errors: 0 };

    // 1. Check sent invoices with payment addresses for incoming payments
    const { data: sentInvoices } = await supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name, merchant_id)
      `)
      .eq('status', 'sent')
      .not('payment_address', 'is', null);

    if (sentInvoices) {
      for (const invoice of sentInvoices) {
        stats.checked++;
        try {
          // Check if there's a confirmed payment matching this address
          // Look in payment_addresses table for payment status
          const { data: paymentAddr } = await supabase
            .from('payment_addresses')
            .select('*')
            .eq('address', invoice.payment_address)
            .single();

          if (paymentAddr) {
            // Check for corresponding payment record
            const { data: payment } = await supabase
              .from('payments')
              .select('*')
              .eq('payment_address', invoice.payment_address)
              .in('status', ['confirmed', 'forwarded', 'forwarding'])
              .single();

            if (payment) {
              // Mark invoice as paid
              await supabase
                .from('invoices')
                .update({
                  status: 'paid',
                  paid_at: new Date().toISOString(),
                  tx_hash: payment.tx_hash,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', invoice.id);

              stats.paid++;

              // Send confirmation email to merchant
              const { data: merchant } = await supabase
                .from('merchants')
                .select('email')
                .eq('id', invoice.businesses?.merchant_id || invoice.user_id)
                .single();

              if (merchant?.email) {
                const feeRate = parseFloat(invoice.fee_rate) || 0.01;
                const amount = parseFloat(invoice.amount);
                const template = invoicePaidMerchantTemplate({
                  invoiceNumber: invoice.invoice_number,
                  amount,
                  currency: invoice.currency || 'USD',
                  cryptoAmount: invoice.crypto_amount || '0',
                  cryptoCurrency: invoice.crypto_currency || '',
                  txHash: payment.tx_hash || 'N/A',
                  feeAmount: amount * feeRate,
                  feeRate,
                  merchantAmount: amount * (1 - feeRate),
                  clientName: invoice.clients?.name,
                  clientEmail: invoice.clients?.email,
                  businessName: invoice.businesses?.name || 'CoinPay Merchant',
                });

                await sendEmail({
                  to: merchant.email,
                  subject: template.subject,
                  html: template.html,
                });
              }
            }
          }
        } catch (err) {
          console.error(`Error checking invoice ${invoice.id}:`, err);
          stats.errors++;
        }
      }
    }

    // 2. Mark overdue invoices and send reminders
    const { data: overdueInvoices } = await supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name)
      `)
      .eq('status', 'sent')
      .not('due_date', 'is', null)
      .lt('due_date', now.toISOString());

    if (overdueInvoices) {
      for (const invoice of overdueInvoices) {
        try {
          await supabase
            .from('invoices')
            .update({ status: 'overdue', updated_at: new Date().toISOString() })
            .eq('id', invoice.id);

          stats.overdue++;

          // Send overdue reminder to client
          const clientEmail = invoice.clients?.email;
          if (clientEmail) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
            const template = invoiceOverdueTemplate({
              invoiceNumber: invoice.invoice_number,
              amount: parseFloat(invoice.amount),
              currency: invoice.currency || 'USD',
              dueDate: invoice.due_date,
              businessName: invoice.businesses?.name || 'CoinPay Merchant',
              paymentLink: `${appUrl}/invoices/${invoice.id}/pay`,
            });

            await sendEmail({
              to: clientEmail,
              subject: template.subject,
              html: template.html,
            });

            stats.reminders++;
          }
        } catch (err) {
          console.error(`Error processing overdue invoice ${invoice.id}:`, err);
          stats.errors++;
        }
      }
    }

    return NextResponse.json({ success: true, timestamp: now.toISOString(), stats });
  } catch (error) {
    console.error('Invoice monitor error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Monitor failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
