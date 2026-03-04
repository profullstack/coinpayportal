/**
 * Invoice Scheduler Cron
 *
 * GET/POST /api/cron/invoice-scheduler
 *
 * Checks invoice_schedules, creates new invoices from templates when due,
 * and sends them automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function authenticateRequest(request: NextRequest): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_KEY;
  if (!cronSecret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader?.replace('Bearer ', '') === cronSecret;
}

function calculateNextDueDate(current: Date, recurrence: string, customDays?: number): Date {
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
    const stats = { processed: 0, created: 0, deactivated: 0, errors: 0 };

    // Get active schedules that are due
    const { data: schedules } = await supabase
      .from('invoice_schedules')
      .select(`
        *,
        invoices (*)
      `)
      .eq('active', true)
      .lte('next_due_date', now.toISOString());

    if (!schedules || schedules.length === 0) {
      return NextResponse.json({ success: true, timestamp: now.toISOString(), stats });
    }

    for (const schedule of schedules) {
      stats.processed++;
      try {
        const templateInvoice = schedule.invoices;
        if (!templateInvoice) {
          stats.errors++;
          continue;
        }

        // Check if max occurrences reached or end date passed
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

        // Create new invoice from template
        const nextDueDate = calculateNextDueDate(
          new Date(schedule.next_due_date),
          schedule.recurrence,
          schedule.custom_interval_days
        );

        const { data: newInvoice, error: createError } = await supabase
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
          })
          .select()
          .single();

        if (createError || !newInvoice) {
          console.error(`Failed to create scheduled invoice:`, createError);
          stats.errors++;
          continue;
        }

        // Update schedule
        await supabase
          .from('invoice_schedules')
          .update({
            next_due_date: nextDueDate.toISOString(),
            occurrences_count: schedule.occurrences_count + 1,
          })
          .eq('id', schedule.id);

        stats.created++;

        // TODO: Auto-send the invoice via /api/invoices/[id]/send
        // For now, invoices are created as drafts for the merchant to review and send

      } catch (err) {
        console.error(`Error processing schedule ${schedule.id}:`, err);
        stats.errors++;
      }
    }

    return NextResponse.json({ success: true, timestamp: now.toISOString(), stats });
  } catch (error) {
    console.error('Invoice scheduler error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scheduler failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
