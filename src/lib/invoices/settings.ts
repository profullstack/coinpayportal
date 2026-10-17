import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

/**
 * Per-business invoice settings: reminder schedule, late fee and branding.
 * A business with no row gets DEFAULT_INVOICE_SETTINGS, which reproduces the
 * old behaviour exactly: one overdue email when the due date passes, no fee.
 */

export type InvoiceSettings = {
  reminders_enabled: boolean;
  reminder_days: number[];
  late_fee_type: 'none' | 'percent' | 'fixed';
  late_fee_value: number | null;
  late_fee_after_days: number;
  brand_color: string | null;
  logo_url: string | null;
  invoice_footer: string | null;
};

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  reminders_enabled: true,
  reminder_days: [0],
  late_fee_type: 'none',
  late_fee_value: null,
  late_fee_after_days: 0,
  brand_color: null,
  logo_url: null,
  invoice_footer: null,
};

export const SETTINGS_COLUMNS =
  'business_id, reminders_enabled, reminder_days, late_fee_type, late_fee_value, late_fee_after_days, brand_color, logo_url, invoice_footer';

/**
 * A step is only taken while it is fresh. Without this, turning reminders on
 * (or this deploy) would email every client whose invoice went overdue months
 * ago, and switching on a late fee would charge all of them at once.
 */
export const STEP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const settingsUpdateSchema = z
  .object({
    reminders_enabled: z.boolean(),
    reminder_days: z
      .array(z.number().int().min(-60).max(365))
      .max(10)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    late_fee_type: z.enum(['none', 'percent', 'fixed']),
    late_fee_value: z
      .number()
      .finite()
      .positive()
      .refine((n) => n === Math.round(n * 100) / 100, 'Use at most two decimals')
      .nullable(),
    late_fee_after_days: z.number().int().min(0).max(365),
    brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #7c3aed').nullable(),
    logo_url: z
      .string()
      .max(500)
      .url()
      .refine((u) => u.startsWith('https://'), 'The logo must be an https:// URL')
      .nullable(),
    invoice_footer: z.string().max(1000).nullable(),
  })
  .partial()
  .strict()
  .superRefine((s, ctx) => {
    if (s.late_fee_type && s.late_fee_type !== 'none' && !s.late_fee_value) {
      ctx.addIssue({ code: 'custom', path: ['late_fee_value'], message: 'A late fee needs a value' });
    }
    if (s.late_fee_type === 'percent' && s.late_fee_value && s.late_fee_value > 100) {
      ctx.addIssue({ code: 'custom', path: ['late_fee_value'], message: 'A percent fee cannot exceed 100' });
    }
  });

function normalize(row: Partial<InvoiceSettings> | null | undefined): InvoiceSettings {
  if (!row) return { ...DEFAULT_INVOICE_SETTINGS };
  return {
    ...DEFAULT_INVOICE_SETTINGS,
    ...row,
    reminder_days: Array.isArray(row.reminder_days) ? row.reminder_days : DEFAULT_INVOICE_SETTINGS.reminder_days,
    late_fee_value: row.late_fee_value == null ? null : Number(row.late_fee_value),
  };
}

/**
 * Never throws: settings shape emails and pages, and a lookup failure must not
 * stop an invoice going out. It falls back to the defaults instead.
 */
export async function loadInvoiceSettings(supabase: SupabaseClient, businessId: string): Promise<InvoiceSettings> {
  try {
    const { data } = await supabase
      .from('invoice_settings')
      .select(SETTINGS_COLUMNS)
      .eq('business_id', businessId)
      .maybeSingle();
    return normalize(data as Partial<InvoiceSettings> | null);
  } catch {
    return normalize(null);
  }
}

/** Settings for many businesses in one query, defaults filled in. */
export async function loadInvoiceSettingsMap(
  supabase: SupabaseClient,
  businessIds: string[]
): Promise<Map<string, InvoiceSettings>> {
  const map = new Map<string, InvoiceSettings>();
  const ids = [...new Set(businessIds)];
  if (ids.length === 0) return map;
  const { data } = await supabase.from('invoice_settings').select(SETTINGS_COLUMNS).in('business_id', ids);
  for (const id of ids) map.set(id, normalize(null));
  for (const row of (data ?? []) as Array<Partial<InvoiceSettings> & { business_id: string }>) {
    map.set(row.business_id, normalize(row));
  }
  return map;
}

/** Reminder offsets whose moment has arrived and is still inside the window. */
export function dueReminderOffsets(
  dueDate: string | Date,
  settings: InvoiceSettings,
  now: Date,
  alreadyDone: Set<number>
): number[] {
  if (!settings.reminders_enabled) return [];
  const due = new Date(dueDate).getTime();
  return settings.reminder_days.filter((offset) => {
    if (alreadyDone.has(offset)) return false;
    const at = due + offset * DAY_MS;
    return now.getTime() >= at && now.getTime() - at < STEP_WINDOW_MS;
  });
}

/** Whether the late fee should be charged now (fresh, enabled, not yet done). */
export function lateFeeDue(dueDate: string | Date, settings: InvoiceSettings, now: Date): boolean {
  if (settings.late_fee_type === 'none' || !settings.late_fee_value) return false;
  const at = new Date(dueDate).getTime() + settings.late_fee_after_days * DAY_MS;
  // Strictly after the due moment: an invoice is not late at the instant it is due.
  return now.getTime() > at && now.getTime() - at < STEP_WINDOW_MS;
}

/** The fee in invoice currency, rounded to cents; null when there is none. */
export function computeLateFee(amount: number | string, settings: InvoiceSettings): number | null {
  if (settings.late_fee_type === 'none' || !settings.late_fee_value) return null;
  const fee =
    settings.late_fee_type === 'fixed'
      ? settings.late_fee_value
      : Math.round(Number(amount) * settings.late_fee_value) / 100;
  return fee >= 0.01 ? Math.round(fee * 100) / 100 : null;
}
