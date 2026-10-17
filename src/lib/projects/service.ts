import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { insertWithInvoiceNumber } from '@/lib/invoices/numbering';
import { computeInvoiceTotals, itemisedInvoiceColumns, type LineItemInput } from '@/lib/invoices/line-items';
import { isBusinessPaidTier } from '@/lib/entitlements/service';
import { getFeePercentage } from '@/lib/payments/fees';

/**
 * Projects and time tracking. Billable, unbilled time becomes an itemised
 * draft invoice; each entry is claimed by setting its invoice_id only where it
 * is still null, so the same hour can never land on two invoices.
 */

export const PROJECT_COLUMNS =
  'id, business_id, client_id, name, hourly_rate, currency, budget_hours, status, notes, created_at, updated_at, clients (id, name, company_name, email)';
export const ENTRY_COLUMNS =
  'id, business_id, project_id, merchant_id, description, started_at, ended_at, minutes, billable, hourly_rate, invoice_id, created_at';

const rate = z
  .number()
  .finite()
  .min(0)
  .max(999_999_999.99)
  .refine((n) => n === Math.round(n * 100) / 100, 'Use at most two decimals');

export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    client_id: z.string().uuid().nullable().optional(),
    hourly_rate: rate.nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    budget_hours: z.number().positive().max(1_000_000).nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const entrySchema = z
  .object({
    project_id: z.string().uuid(),
    description: z.string().max(500).optional(),
    minutes: z.number().int().min(1).max(100_000).optional(),
    started_at: z.string().datetime({ offset: true }).optional(),
    billable: z.boolean().optional(),
    hourly_rate: rate.nullable().optional(),
    /** Start a running timer instead of logging finished time. */
    start: z.literal(true).optional(),
  })
  .strict()
  .refine((e) => !!e.start !== (e.minutes !== undefined), 'Send minutes, or start: true for a timer');

export const entryUpdateSchema = z
  .object({
    description: z.string().max(500),
    minutes: z.number().int().min(1).max(100_000),
    started_at: z.string().datetime({ offset: true }),
    billable: z.boolean(),
    hourly_rate: rate.nullable(),
    stop: z.literal(true),
  })
  .partial()
  .strict();

/** Whole minutes between start and stop, at least one. */
export function elapsedMinutes(startedAt: string, stoppedAt: Date): number {
  return Math.max(1, Math.round((stoppedAt.getTime() - new Date(startedAt).getTime()) / 60_000));
}

type Entry = {
  id: string;
  description: string;
  started_at: string;
  minutes: number | null;
  billable: boolean;
  hourly_rate: number | string | null;
  invoice_id: string | null;
};

/** One invoice line per entry: "Description (Oct 17)", hours x rate. */
export function linesFromEntries(entries: Entry[], projectName: string, projectRate: number | null): LineItemInput[] {
  return entries.map((e) => {
    const unit = e.hourly_rate != null ? Number(e.hourly_rate) : projectRate ?? 0;
    const date = new Date(e.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return {
      description: `${e.description.trim() || projectName} (${date})`,
      quantity: Math.round(((e.minutes ?? 0) / 60) * 10_000) / 10_000,
      unit_price: unit,
    };
  });
}

export type BillResult =
  | { ok: true; invoice: { id: string; invoice_number: string; amount: number }; entries: number }
  | { ok: false; status: number; error: string };

/** Turn a project's billable, unbilled, finished time into a draft invoice. */
export async function billProjectTime(
  supabase: SupabaseClient,
  projectId: string,
  entryIds?: string[]
): Promise<BillResult> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, business_id, client_id, name, hourly_rate, currency')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  let query = supabase
    .from('time_entries')
    .select(ENTRY_COLUMNS)
    .eq('project_id', projectId)
    .eq('billable', true)
    .is('invoice_id', null)
    .not('minutes', 'is', null)
    .order('started_at');
  if (entryIds?.length) query = query.in('id', entryIds);
  const { data: entries } = await query;
  const rows = (entries ?? []) as Entry[];
  if (rows.length === 0) return { ok: false, status: 400, error: 'No unbilled billable time on this project' };

  const projectRate = project.hourly_rate == null ? null : Number(project.hourly_rate);
  const lines = linesFromEntries(rows, project.name, projectRate).filter((l) => l.unit_price > 0);
  if (lines.length === 0) {
    return { ok: false, status: 400, error: 'Set an hourly rate on the project or its entries before invoicing' };
  }
  let totals;
  try {
    totals = computeInvoiceTotals(lines.slice(0, 100));
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : 'Invalid time entries' };
  }
  const billed = rows.filter((e) => (e.hourly_rate != null ? Number(e.hourly_rate) : projectRate ?? 0) > 0).slice(0, 100);

  const { data: business } = await supabase
    .from('businesses')
    .select('merchant_id')
    .eq('id', project.business_id)
    .single();
  const feeRate = getFeePercentage(await isBusinessPaidTier(supabase, project.business_id));

  const { data: invoice, error } = await insertWithInvoiceNumber<any>(supabase, project.business_id, (invoiceNumber) =>
    supabase
      .from('invoices')
      .insert({
        user_id: business?.merchant_id,
        business_id: project.business_id,
        client_id: project.client_id,
        invoice_number: invoiceNumber,
        status: 'draft',
        currency: project.currency || 'USD',
        ...itemisedInvoiceColumns(totals),
        fee_rate: feeRate,
        notes: `Time on ${project.name}`,
        metadata: { project_id: project.id },
      })
      .select('id, invoice_number, amount')
      .single()
  );
  if (error || !invoice) return { ok: false, status: 500, error: 'Could not create the invoice' };

  // Claim the entries. If another bill took some first, undo this one.
  const ids = billed.map((e) => e.id);
  const { data: claimed } = await supabase
    .from('time_entries')
    .update({ invoice_id: invoice.id, updated_at: new Date().toISOString() })
    .in('id', ids)
    .is('invoice_id', null)
    .select('id');
  if ((claimed ?? []).length !== ids.length) {
    await supabase.from('time_entries').update({ invoice_id: null }).eq('invoice_id', invoice.id);
    await supabase.from('invoices').delete().eq('id', invoice.id).eq('status', 'draft');
    return { ok: false, status: 409, error: 'Some of this time was invoiced at the same moment; refresh and retry' };
  }

  return { ok: true, invoice: { ...invoice, amount: Number(invoice.amount) }, entries: ids.length };
}

/** Hours, billable value, and what has been billed and paid, for one project. */
export async function projectStats(supabase: SupabaseClient, projectId: string, projectRate: number | null) {
  const { data: entries } = await supabase
    .from('time_entries')
    .select('minutes, billable, hourly_rate, invoice_id')
    .eq('project_id', projectId);
  let minutes = 0;
  let billableMinutes = 0;
  let unbilledCents = 0;
  const invoiceIds = new Set<string>();
  for (const e of entries ?? []) {
    if (e.minutes == null) continue;
    minutes += e.minutes;
    if (!e.billable) continue;
    billableMinutes += e.minutes;
    if (e.invoice_id) invoiceIds.add(e.invoice_id);
    else {
      const r = e.hourly_rate != null ? Number(e.hourly_rate) : projectRate ?? 0;
      unbilledCents += Math.round((e.minutes / 60) * r * 100);
    }
  }
  let billedCents = 0;
  let paidCents = 0;
  if (invoiceIds.size) {
    const { data: invoices } = await supabase.from('invoices').select('amount, status').in('id', [...invoiceIds]);
    for (const inv of invoices ?? []) {
      if (inv.status === 'cancelled') continue;
      const c = Math.round(Number(inv.amount) * 100);
      billedCents += c;
      if (inv.status === 'paid') paidCents += c;
    }
  }
  return {
    hours: Math.round((minutes / 60) * 100) / 100,
    billable_hours: Math.round((billableMinutes / 60) * 100) / 100,
    unbilled_amount: unbilledCents / 100,
    billed_amount: billedCents / 100,
    paid_amount: paidCents / 100,
  };
}
