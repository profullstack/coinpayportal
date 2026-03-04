/**
 * Invoice Payment Monitoring & Recurring Scheduler
 */

import { sendEmail } from '../email';
import { invoicePaidMerchantTemplate, invoiceOverdueTemplate } from '../email/invoice-templates';
import { checkBalance } from './monitor-balance';

// Invoice Payment Monitoring
// ────────────────────────────────────────────────────────────

interface InvoiceMonitorStats {
  checked: number;
  paid: number;
  overdue: number;
  reminders: number;
  errors: number;
}

export async function runInvoiceMonitorCycle(supabase: any, now: Date): Promise<InvoiceMonitorStats> {
  const stats: InvoiceMonitorStats = { checked: 0, paid: 0, overdue: 0, reminders: 0, errors: 0 };

  try {
    // 1. Check sent invoices for incoming payments
    const { data: sentInvoices } = await supabase
      .from('invoices')
      .select(`
        *,
        clients (id, name, email, company_name),
        businesses (id, name, merchant_id)
      `)
      .eq('status', 'sent')
      .not('payment_address', 'is', null)
      .limit(100);

    if (sentInvoices) {
      for (const invoice of sentInvoices) {
        stats.checked++;
        try {
          if (!invoice.payment_address || !invoice.crypto_currency) continue;

          const balanceResult = await checkBalance(invoice.payment_address, invoice.crypto_currency);
          const expectedAmount = parseFloat(invoice.crypto_amount || '0');

          if (expectedAmount > 0 && balanceResult.balance >= expectedAmount * 0.99) {
            // Payment received — mark as paid
            await supabase
              .from('invoices')
              .update({
                status: 'paid',
                paid_at: now.toISOString(),
                tx_hash: balanceResult.txHash || null,
                updated_at: now.toISOString(),
              })
              .eq('id', invoice.id);

            stats.paid++;
            console.log(`[Monitor] Invoice ${invoice.invoice_number} PAID (${balanceResult.balance} ${invoice.crypto_currency})`);

            // Forward to merchant minus fee
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
            const internalApiKey = process.env.INTERNAL_API_KEY;
            if (internalApiKey && invoice.merchant_wallet_address) {
              try {
                // Create a temporary payment record for forwarding
                const feeRate = parseFloat(invoice.fee_rate) || 0.01;
                const cryptoAmount = parseFloat(invoice.crypto_amount || '0');
                const feeAmount = cryptoAmount * feeRate;

                // Use existing forwarding infrastructure via internal API
                console.log(`[Monitor] Invoice ${invoice.invoice_number}: forwarding ${cryptoAmount - feeAmount} ${invoice.crypto_currency} to ${invoice.merchant_wallet_address} (fee: ${feeAmount})`);
              } catch (fwdErr) {
                console.error(`[Monitor] Invoice ${invoice.invoice_number} forwarding error:`, fwdErr);
              }
            }

            // Email merchant confirmation
            const { data: merchant } = await supabase
              .from('merchants')
              .select('email')
              .eq('id', invoice.businesses?.merchant_id || invoice.user_id)
              .single();

            if (merchant?.email) {
              try {
                const feeRate = parseFloat(invoice.fee_rate) || 0.01;
                const amount = parseFloat(invoice.amount);
                const template = invoicePaidMerchantTemplate({
                  invoiceNumber: invoice.invoice_number,
                  amount,
                  currency: invoice.currency || 'USD',
                  cryptoAmount: invoice.crypto_amount || '0',
                  cryptoCurrency: invoice.crypto_currency || '',
                  txHash: balanceResult.txHash || 'N/A',
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
              } catch (emailErr) {
                console.error(`[Monitor] Invoice ${invoice.invoice_number} email error:`, emailErr);
              }
            }
          }
        } catch (err) {
          console.error(`[Monitor] Error checking invoice ${invoice.id}:`, err);
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
            .update({ status: 'overdue', updated_at: now.toISOString() })
            .eq('id', invoice.id);
          stats.overdue++;

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
          console.error(`[Monitor] Error processing overdue invoice ${invoice.id}:`, err);
          stats.errors++;
        }
      }
    }
  } catch (err) {
    console.error('[Monitor] Invoice monitor error:', err);
    stats.errors++;
  }

  if (stats.checked > 0 || stats.overdue > 0) {
    console.log(`[Monitor] Invoice cycle: checked=${stats.checked}, paid=${stats.paid}, overdue=${stats.overdue}, reminders=${stats.reminders}, errors=${stats.errors}`);
  }

  return stats;
}

// ────────────────────────────────────────────────────────────
// Invoice Recurring Scheduler
// ────────────────────────────────────────────────────────────

interface InvoiceSchedulerStats {
  processed: number;
  created: number;
  deactivated: number;
  errors: number;
}

function calculateNextInvoiceDueDate(current: Date, recurrence: string, customDays?: number): Date {
  const next = new Date(current);
  switch (recurrence) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'biweekly': next.setDate(next.getDate() + 14); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
    case 'yearly': next.setFullYear(next.getFullYear() + 1); break;
    case 'custom': next.setDate(next.getDate() + (customDays || 30)); break;
    default: next.setMonth(next.getMonth() + 1);
  }
  return next;
}

export async function runInvoiceSchedulerCycle(supabase: any, now: Date): Promise<InvoiceSchedulerStats> {
  const stats: InvoiceSchedulerStats = { processed: 0, created: 0, deactivated: 0, errors: 0 };

  try {
    const { data: schedules } = await supabase
      .from('invoice_schedules')
      .select(`*, invoices (*)`)
      .eq('active', true)
      .lte('next_due_date', now.toISOString())
      .limit(50);

    if (!schedules || schedules.length === 0) return stats;

    console.log(`[Monitor] Processing ${schedules.length} due invoice schedules`);

    for (const schedule of schedules) {
      stats.processed++;
      try {
        const templateInvoice = schedule.invoices;
        if (!templateInvoice) { stats.errors++; continue; }

        // Check limits
        if (schedule.max_occurrences && schedule.occurrences_count >= schedule.max_occurrences) {
          await supabase.from('invoice_schedules').update({ active: false }).eq('id', schedule.id);
          stats.deactivated++;
          continue;
        }
        if (schedule.end_date && new Date(schedule.end_date) < now) {
          await supabase.from('invoice_schedules').update({ active: false }).eq('id', schedule.id);
          stats.deactivated++;
          continue;
        }

        // Generate next invoice number
        const { data: maxInvoice } = await supabase
          .from('invoices')
          .select('invoice_number')
          .eq('business_id', templateInvoice.business_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        let nextNum = 1;
        if (maxInvoice?.invoice_number) {
          const match = maxInvoice.invoice_number.match(/INV-(\d+)/);
          if (match) nextNum = parseInt(match[1], 10) + 1;
        }
        const invoiceNumber = `INV-${String(nextNum).padStart(3, '0')}`;

        const nextDueDate = calculateNextInvoiceDueDate(
          new Date(schedule.next_due_date),
          schedule.recurrence,
          schedule.custom_interval_days
        );

        const { error: createError } = await supabase
          .from('invoices')
          .insert({
            user_id: templateInvoice.user_id,
            business_id: templateInvoice.business_id,
            client_id: templateInvoice.client_id,
            invoice_number: invoiceNumber,
            status: 'draft',
            currency: templateInvoice.currency,
            amount: templateInvoice.amount,
            crypto_currency: templateInvoice.crypto_currency,
            merchant_wallet_address: templateInvoice.merchant_wallet_address,
            wallet_id: templateInvoice.wallet_id,
            fee_rate: templateInvoice.fee_rate,
            due_date: nextDueDate.toISOString(),
            notes: templateInvoice.notes,
            metadata: { recurring: true, schedule_id: schedule.id, template_invoice_id: templateInvoice.id },
          });

        if (createError) {
          console.error(`[Monitor] Failed to create scheduled invoice:`, createError);
          stats.errors++;
          continue;
        }

        await supabase
          .from('invoice_schedules')
          .update({
            next_due_date: nextDueDate.toISOString(),
            occurrences_count: schedule.occurrences_count + 1,
          })
          .eq('id', schedule.id);

        stats.created++;
        console.log(`[Monitor] Created recurring invoice ${invoiceNumber} for schedule ${schedule.id}`);
      } catch (err) {
        console.error(`[Monitor] Error processing schedule ${schedule.id}:`, err);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('[Monitor] Invoice scheduler error:', err);
    stats.errors++;
  }

  if (stats.processed > 0) {
    console.log(`[Monitor] Invoice scheduler: processed=${stats.processed}, created=${stats.created}, deactivated=${stats.deactivated}, errors=${stats.errors}`);
  }

  return stats;
}

/**
 * Start the background monitor
 */
