/**
 * Invoice Payment Monitoring & Recurring Scheduler
 */

import { sendEmail } from '../email';
import { invoicePaidMerchantTemplate, invoiceOverdueTemplate } from '../email/invoice-templates';
import { checkBalance } from './monitor-balance';
import { isSufficientPayment } from './tolerance';
import { resolvePayee } from './payee';
import { getPaymentReceivingWallet } from '../wallets/supported-coins';
import { fetchAllKeyset } from '../db/keyset';

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
    //
    // F-1.3-09: this was `.limit(100)` with no `.order()`. An invoice stays
    // `sent` until it is paid, so the matching set does not drain — once more
    // than 100 invoices are awaiting payment, the same 100 are checked on every
    // run and the rest are never checked at all. Payments to them are simply
    // never detected, and the whole invoice rail stalls platform-wide with no
    // error anywhere. (18 invoices are `sent` in production today, so this is
    // latent rather than active — but it triggers on growth, silently.)
    //
    // Ordering alone would not fix it: an ordered query returns the same first
    // page just as reliably. The page has to advance, so this walks the set.
    const { rows: sentInvoices, truncated, error: sweepError } = await fetchAllKeyset<any>(
      (cursor, pageSize) => {
        let q = supabase
          .from('invoices')
          .select(`
            *,
            clients (id, name, email, company_name),
            businesses (id, name, merchant_id)
          `)
          .eq('status', 'sent')
          .not('payment_address', 'is', null)
          .order('id', { ascending: true })
          .limit(pageSize);
        if (cursor) q = q.gt('id', cursor);
        return q as unknown as Promise<{ data: any[] | null; error: { message: string } | null }>;
      }
    );

    if (sweepError) {
      console.error('[Monitor] Invoice sweep page failed:', sweepError);
      stats.errors++;
    }
    if (truncated) {
      console.warn('[Monitor] Invoice sweep hit its row ceiling; the tail was not checked this run');
    }

    if (sentInvoices) {
      for (const invoice of sentInvoices) {
        stats.checked++;
        try {
          if (!invoice.payment_address || !invoice.crypto_currency) continue;

          const metadata = (invoice.metadata && typeof invoice.metadata === 'object') ? invoice.metadata : {};
          const linkedPaymentId = metadata.coinpay_payment_id;
          if (linkedPaymentId) {
            const { data: linkedPayment } = await supabase
              .from('payments')
              .select('id, status, tx_hash, forward_tx_hash, updated_at')
              .eq('id', linkedPaymentId)
              .single();

            // 'forwarding_failed' is deliberately NOT in this set.
            //
            // It used to be, which meant an invoice flipped to 'paid' in the
            // merchant's dashboard while the forward had actually failed and
            // the funds were still sitting at the intermediary address. The
            // merchant saw a settled invoice and no reason to look further.
            // The customer's payment is real either way, but "paid" here means
            // the money reached the merchant — so the invoice stays open until
            // the forward lands. The retry queue and rescanLateDeposits both
            // re-drive these, so this resolves itself rather than sticking.
            const SETTLES_INVOICE = ['confirmed', 'forwarding', 'forwarded'];

            if (linkedPayment && linkedPayment.status === 'forwarding_failed') {
              console.warn(
                `[Monitor] Invoice ${invoice.invoice_number} has a confirmed payment ` +
                  `(${linkedPaymentId}) whose forward FAILED — leaving the invoice unpaid ` +
                  `until the funds reach the merchant.`
              );
            }

            if (linkedPayment && SETTLES_INVOICE.includes(linkedPayment.status)) {
              await supabase
                .from('invoices')
                .update({
                  status: 'paid',
                  paid_at: now.toISOString(),
                  tx_hash: linkedPayment.tx_hash || linkedPayment.forward_tx_hash || null,
                  updated_at: now.toISOString(),
                })
                .eq('id', invoice.id);

              stats.paid++;
              console.log(`[Monitor] Invoice ${invoice.invoice_number} PAID via CoinPay payment ${linkedPaymentId}`);
            }

            // Linked invoices are forwarded by the normal payments monitor.
            continue;
          }

          const balanceResult = await checkBalance(invoice.payment_address, invoice.crypto_currency);
          const expectedAmount = parseFloat(invoice.crypto_amount || '0');

            // Full payment, via the shared rule.
          //
          // This read `balance >= expected * 0.99`, bypassing
          // `isSufficientPayment`. That 1% discount is the exact economic
          // concession the shared helper was written to remove: the payer
          // unlocks the goods on 99%, and the forwarder is then asked to send
          // 100% out of an address holding 99%, so the forward fails and the
          // funds strand at the intermediary address.
          if (isSufficientPayment(balanceResult.balance, expectedAmount)) {
            // Put the money on its way before declaring the invoice settled.
            //
            // This branch handles invoices with no linked CoinPay payment. It
            // used to compute the split and then only console.log it — the
            // funds were never forwarded, yet the invoice was marked paid and
            // the merchant emailed a confirmation. Recover the owning payment
            // from the address itself so the normal secure-forwarding path can
            // run; if there genuinely isn't one, say so loudly rather than
            // implying a transfer happened.
            const { data: addrRow } = await supabase
              .from('payment_addresses')
              .select('payment_id, merchant_wallet')
              .eq('address', invoice.payment_address)
              .maybeSingle();

            const internalApiKey = process.env.INTERNAL_API_KEY;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

            if (addrRow?.payment_id && internalApiKey) {
              try {
                const res = await fetch(`${appUrl}/api/payments/${addrRow.payment_id}/forward`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${internalApiKey}`,
                  },
                });
                if (!res.ok) {
                  console.error(
                    `[Monitor] Invoice ${invoice.invoice_number}: forwarding returned ${res.status} - ${await res.text()}`,
                  );
                } else {
                  console.log(`[Monitor] Invoice ${invoice.invoice_number}: forwarding triggered for payment ${addrRow.payment_id}`);
                }
              } catch (fwdErr) {
                console.error(`[Monitor] Invoice ${invoice.invoice_number} forwarding error:`, fwdErr);
              }
            } else {
              // Funds arrived at an address no payment record owns, so there is
              // no forwarding path and the money is stranded at the
              // intermediary address.
              //
              // This case used to fall through and mark the invoice `paid` and
              // email the merchant "Payment Received" — telling them they had
              // been paid while nothing could move the funds to them, and
              // clearing the invoice off every outstanding list that would have
              // surfaced the problem.
              //
              // Leaving it unpaid keeps it visible as outstanding, which is the
              // accurate state: the customer paid, the merchant has not been.
              // The observation is recorded so an operator can find it.
              console.error(
                `[Monitor] Invoice ${invoice.invoice_number}: ${balanceResult.balance} ${invoice.crypto_currency} received at ` +
                  `${invoice.payment_address} but no payment record owns that address — funds need manual recovery. ` +
                  `NOT marking the invoice paid.`,
              );

              await supabase
                .from('invoices')
                .update({
                  metadata: {
                    ...(invoice.metadata && typeof invoice.metadata === 'object' ? invoice.metadata : {}),
                    unforwardable_balance: {
                      observed_at: now.toISOString(),
                      balance: balanceResult.balance,
                      currency: invoice.crypto_currency,
                      address: invoice.payment_address,
                      reason: 'no payment record owns this address',
                    },
                  },
                  updated_at: now.toISOString(),
                })
                .eq('id', invoice.id);

              continue;
            }

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

/**
 * Template statuses that stop a series dead.
 *
 * A schedule is standing authority to mint invoices inside someone's business,
 * granted once when the template was created and never re-checked afterwards —
 * this job runs under the service role with no caller to authorize. That makes
 * the template invoice the merchant's revocation handle, so cancelling it has
 * to stop the series. Until this guard existed a cancelled template kept
 * minting monthly: INV-012 was generated a month after its source, INV-003, was
 * cancelled ten minutes into its life.
 */
const REVOKED_TEMPLATE_STATUSES = new Set(['cancelled']);

async function deactivateSchedule(supabase: any, scheduleId: string, reason: string): Promise<void> {
  await supabase.from('invoice_schedules').update({ active: false }).eq('id', scheduleId);
  console.log(`[Monitor] Deactivated invoice schedule ${scheduleId}: ${reason}`);
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
          await deactivateSchedule(supabase, schedule.id, 'max_occurrences reached');
          stats.deactivated++;
          continue;
        }
        if (schedule.end_date && new Date(schedule.end_date) < now) {
          await deactivateSchedule(supabase, schedule.id, 'end_date passed');
          stats.deactivated++;
          continue;
        }
        if (REVOKED_TEMPLATE_STATUSES.has(templateInvoice.status)) {
          await deactivateSchedule(
            supabase,
            schedule.id,
            `template invoice ${templateInvoice.invoice_number} is ${templateInvoice.status}`,
          );
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

        // Re-resolve the payee every cycle rather than copying the template's
        // address through untouched. The address was authorized once, by
        // whoever created the template — they may since have been removed from
        // the business or had their API key rotated, and nothing else in this
        // job would notice. Running the same resolution the interactive paths
        // use keeps unattended invoices under the same payee rule as manual
        // ones, instead of exempting them from it.
        const payee = await resolvePayee(supabase, {
          businessId: templateInvoice.business_id,
          merchantId: templateInvoice.user_id,
          cryptocurrency: templateInvoice.crypto_currency,
          requestedAddress: templateInvoice.merchant_wallet_address,
          inherited: true,
        });

        if (!payee.ok) {
          // Every invoice this series would mint is unpayable — or worse, would
          // settle to the platform wallet. Stop and let the merchant re-point
          // the schedule instead of emitting a stream of broken invoices.
          await deactivateSchedule(supabase, schedule.id, `payee unresolvable (${payee.code})`);
          stats.deactivated++;
          continue;
        }

        // A payee the account can no longer derive from its own wallet config is
        // not necessarily wrong — merchants do enter external addresses by hand.
        // But an unattended job cannot tell that apart from an address left
        // behind by someone who has since lost access, so flag it and let the
        // human decide at send time rather than silently vouching for it.
        const configured = await getPaymentReceivingWallet(supabase, {
          businessId: templateInvoice.business_id,
          merchantId: templateInvoice.user_id,
          cryptocurrency: templateInvoice.crypto_currency,
        });
        const payeeUnverified =
          !configured.walletAddress ||
          configured.walletAddress.toLowerCase() !== payee.address.toLowerCase();

        // The stored wallet_id only describes the template's address; if
        // resolution landed somewhere else it no longer refers to anything.
        const payeeMoved = payee.address !== templateInvoice.merchant_wallet_address;

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
            merchant_wallet_address: payee.address,
            wallet_id: payeeMoved ? null : templateInvoice.wallet_id,
            fee_rate: templateInvoice.fee_rate,
            due_date: nextDueDate.toISOString(),
            notes: templateInvoice.notes,
            metadata: {
              recurring: true,
              schedule_id: schedule.id,
              template_invoice_id: templateInvoice.id,
              payee_source: payee.source,
              ...(payeeUnverified ? { payee_unverified: true } : {}),
            },
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
