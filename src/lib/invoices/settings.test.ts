import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INVOICE_SETTINGS,
  dueReminderOffsets,
  lateFeeDue,
  computeLateFee,
  normalize,
  settingsUpdateSchema,
  type InvoiceSettings,
} from './settings';

const due = '2026-10-10T12:00:00Z';
const at = (iso: string) => new Date(iso);
const settings = (s: Partial<InvoiceSettings>): InvoiceSettings => ({ ...DEFAULT_INVOICE_SETTINGS, ...s });

describe('dueReminderOffsets', () => {
  it('defaults to one reminder on the due date, like the old overdue email', () => {
    expect(dueReminderOffsets(due, DEFAULT_INVOICE_SETTINGS, at('2026-10-10T12:01:00Z'), new Set())).toEqual([0]);
    expect(dueReminderOffsets(due, DEFAULT_INVOICE_SETTINGS, at('2026-10-10T11:59:00Z'), new Set())).toEqual([]);
  });

  it('sends before-due and after-due reminders at their moment', () => {
    const s = settings({ reminder_days: [-3, 0, 7] });
    expect(dueReminderOffsets(due, s, at('2026-10-07T13:00:00Z'), new Set())).toEqual([-3]);
    expect(dueReminderOffsets(due, s, at('2026-10-17T13:00:00Z'), new Set([-3, 0]))).toEqual([7]);
  });

  it('never backfills a step older than the window', () => {
    const s = settings({ reminder_days: [0, 3] });
    // Four days late: the on-due reminder is stale, the 3-day one is fresh.
    expect(dueReminderOffsets(due, s, at('2026-10-14T12:00:00Z'), new Set())).toEqual([3]);
  });

  it('skips steps already done and respects the switch', () => {
    expect(dueReminderOffsets(due, DEFAULT_INVOICE_SETTINGS, at('2026-10-10T13:00:00Z'), new Set([0]))).toEqual([]);
    expect(dueReminderOffsets(due, settings({ reminders_enabled: false }), at('2026-10-10T13:00:00Z'), new Set())).toEqual([]);
  });
});

describe('late fee', () => {
  const fee = settings({ late_fee_type: 'percent', late_fee_value: 1.5, late_fee_after_days: 3 });

  it('is due after the grace period, inside the window', () => {
    expect(lateFeeDue(due, fee, at('2026-10-13T11:00:00Z'))).toBe(false);
    expect(lateFeeDue(due, fee, at('2026-10-13T13:00:00Z'))).toBe(true);
    expect(lateFeeDue(due, fee, at('2026-10-20T13:00:00Z'))).toBe(false);
    expect(lateFeeDue(due, DEFAULT_INVOICE_SETTINGS, at('2026-10-13T13:00:00Z'))).toBe(false);
  });

  it('computes percent and fixed fees in cents', () => {
    expect(computeLateFee(310.27, fee)).toBe(4.65);
    expect(computeLateFee('100', settings({ late_fee_type: 'fixed', late_fee_value: 25 }))).toBe(25);
    expect(computeLateFee(0.1, settings({ late_fee_type: 'percent', late_fee_value: 1 }))).toBeNull();
    expect(computeLateFee(100, DEFAULT_INVOICE_SETTINGS)).toBeNull();
  });
});

describe('normalize', () => {
  it('drops business_id so a stored row merges into an update cleanly', () => {
    const stored = normalize({ business_id: 'b1', reminder_days: [-3, 0], late_fee_type: 'percent', late_fee_value: 1.5 } as never);
    expect(stored).not.toHaveProperty('business_id');
    expect(settingsUpdateSchema.safeParse({ ...stored, brand_color: '#112233' }).success).toBe(true);
  });
});

describe('settingsUpdateSchema', () => {
  it('sorts and de-duplicates reminder days', () => {
    expect(settingsUpdateSchema.parse({ reminder_days: [7, -3, 0, 7] }).reminder_days).toEqual([-3, 0, 7]);
  });

  it('refuses unsafe branding and incomplete fees', () => {
    expect(settingsUpdateSchema.safeParse({ brand_color: 'red;background:url(x)' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ logo_url: 'http://example.com/logo.png' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ logo_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ late_fee_type: 'percent' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ late_fee_type: 'percent', late_fee_value: 150 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ sneaky: true }).success).toBe(false);
    expect(
      settingsUpdateSchema.safeParse({ brand_color: '#7c3aed', logo_url: 'https://example.com/l.png' }).success
    ).toBe(true);
  });
});
