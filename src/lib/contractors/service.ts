import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isCountryCode } from '@/lib/countries';
import { authorizeCatalog, serviceClient } from '@/lib/invoices/catalog';
import { resolveMerchant } from '@/lib/auth/merchant';
import { authorizeBusiness } from '@/lib/auth/authz';
import type { Capability } from '@/lib/auth/permissions';
import { encrypt, decrypt } from '@/lib/crypto/encryption';
import { requireEncryptionKey } from '@/lib/crypto/require-key';
import { isPlausibleWalletAddress } from '@/lib/payouts/service';
import { newPortalToken, PORTAL_TOKEN_PATTERN } from '@/lib/invoices/portal';

/**
 * Contractors: the people a business pays, their contracts, the work they
 * submit, and the pay runs that pay them in crypto. Amounts are USD on the
 * books and converted at the moment a payment is sent.
 *
 * Reads need business.read, day-to-day writes invoice.write, and sending money
 * needs funds.move (owner only) from a signed-in session, never an API key.
 */

/** Coins a contractor can be paid in: what the payout service can send. */
export const PAYOUT_COINS = [
  'USDC_SOL', 'USDC_POL', 'USDC_ETH', 'USDT_SOL', 'USDT_POL', 'USDT_ETH',
  'BTC', 'ETH', 'SOL', 'POL', 'BNB', 'XRP', 'ADA', 'DOGE', 'BCH',
] as const;

export const CONTRACTOR_COLUMNS =
  'id, business_id, name, email, country, job_title, status, payout_currency, payout_wallet, payout_wallet_changed_at, ' +
  'tax_form, tax_status, tax_legal_name, tax_business_name, tax_classification, tax_address, tax_country, tax_id_last4, ' +
  'tax_signed_name, tax_signed_at, notes, portal_token_created_at, created_at, updated_at';
export const CONTRACT_COLUMNS =
  'id, business_id, contractor_id, title, scope, kind, rate, currency, frequency, start_date, end_date, next_pay_date, ' +
  'notice_days, status, business_signed_name, business_signed_at, contractor_signed_name, contractor_signed_at, ' +
  'ended_at, end_reason, created_at, updated_at';
export const MILESTONE_COLUMNS = 'id, contract_id, title, amount, due_date, position, status';
export const WORK_ITEM_COLUMNS =
  'id, business_id, contractor_id, contract_id, kind, milestone_id, description, work_date, minutes, amount, receipt_url, ' +
  'submitted_by, status, reviewed_at, review_note, pay_run_item_id, created_at';
export const PAY_RUN_COLUMNS = 'id, business_id, number, pay_date, status, total, auto_drafted, paid_at, created_at';
export const PAY_RUN_ITEM_COLUMNS =
  'id, pay_run_id, contractor_id, amount, payout_currency, payout_wallet, method, status, tx_hash, error, invoice_number, paid_at';

/** A wallet changed this recently is called out before anyone pays it. */
export const WALLET_CHANGE_WARNING_MS = 72 * 60 * 60 * 1000;

const money = z
  .number()
  .finite()
  .positive()
  .max(9_999_999.99)
  .refine((n) => n === Math.round(n * 100) / 100, 'Use at most two decimals');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const contractorSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().email().max(320),
    country: z.string().trim().toUpperCase().refine(isCountryCode, 'Not an ISO 3166-1 country code').nullable().optional(),
    job_title: z.string().trim().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const milestoneInput = z
  .object({ title: z.string().trim().min(1).max(200), amount: money, due_date: isoDate.nullable().optional() })
  .strict();

export const contractSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    scope: z.string().max(10000).nullable().optional(),
    kind: z.enum(['fixed', 'hourly', 'milestone']),
    rate: money.nullable().optional(),
    frequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']).nullable().optional(),
    start_date: isoDate.optional(),
    end_date: isoDate.nullable().optional(),
    first_pay_date: isoDate.optional(),
    notice_days: z.number().int().min(0).max(365).optional(),
    milestones: z.array(milestoneInput).max(50).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kind === 'fixed' && (!c.rate || !c.frequency)) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: 'A fixed contract needs rate and frequency' });
    }
    if (c.kind === 'hourly' && !c.rate) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: 'An hourly contract needs an hourly rate' });
    }
    if (c.kind === 'milestone' && !c.milestones?.length) {
      ctx.addIssue({ code: 'custom', path: ['milestones'], message: 'A milestone contract needs at least one milestone' });
    }
    if (c.end_date && c.start_date && c.end_date < c.start_date) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'end_date is before start_date' });
    }
  });

/** Business-added lines: a bonus or an expense the business records itself. */
export const businessWorkItemSchema = z
  .object({
    contract_id: z.string().uuid(),
    kind: z.enum(['bonus', 'expense']),
    amount: money,
    description: z.string().trim().min(1).max(1000),
    work_date: isoDate.optional(),
    receipt_url: z.string().url().startsWith('https://').max(1000).nullable().optional(),
  })
  .strict();

export const payoutProfileSchema = z
  .object({
    payout_currency: z.enum(PAYOUT_COINS),
    payout_wallet: z.string().trim().min(20).max(128),
  })
  .strict()
  .refine((p) => isPlausibleWalletAddress(p.payout_wallet, p.payout_currency), {
    path: ['payout_wallet'],
    message: 'That address does not look like a valid address for this coin',
  });

/**
 * Tax form collection. A W-9 is for US persons; W-8BEN for foreign individuals,
 * W-8BEN-E for foreign entities. The tax id is encrypted at rest and only its
 * last four characters are ever shown back.
 */
export const taxFormSchema = z
  .object({
    tax_form: z.enum(['W9', 'W8BEN', 'W8BENE']),
    legal_name: z.string().trim().min(1).max(200),
    business_name: z.string().trim().max(200).nullable().optional(),
    classification: z
      .enum(['individual', 'sole_proprietor', 'llc', 'c_corp', 's_corp', 'partnership', 'trust', 'foreign_entity'])
      .optional(),
    address: z.string().trim().min(5).max(500),
    country: z.string().trim().toUpperCase().refine(isCountryCode, 'Not an ISO 3166-1 country code'),
    tax_id: z.string().trim().max(40).optional(),
    signature: z.string().trim().min(2).max(200),
    certify: z.literal(true),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.tax_form === 'W9') {
      const digits = (f.tax_id ?? '').replace(/\D/g, '');
      if (digits.length !== 9) ctx.addIssue({ code: 'custom', path: ['tax_id'], message: 'A W-9 needs a 9-digit SSN or EIN' });
      if (f.country !== 'US') ctx.addIssue({ code: 'custom', path: ['country'], message: 'A W-9 is for US persons; use a W-8 form' });
    }
    if (f.signature.toLowerCase() !== f.legal_name.toLowerCase()) {
      ctx.addIssue({ code: 'custom', path: ['signature'], message: 'Type your legal name exactly to sign' });
    }
  });

export function zodError(error: z.ZodError): string {
  const issue = error.issues[0];
  return `${issue.path.join('.') || 'body'}: ${issue.message}`;
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

/** Encrypt a tax id for storage; returns the ciphertext and the last four. */
export function sealTaxId(taxId: string): { tax_id_encrypted: string; tax_id_last4: string } {
  const clean = taxId.replace(/[^0-9A-Za-z]/g, '');
  return {
    tax_id_encrypted: encrypt(clean, requireEncryptionKey('contractor tax id')),
    tax_id_last4: clean.slice(-4),
  };
}

export function openTaxId(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return decrypt(sealed, requireEncryptionKey('contractor tax id'));
  } catch {
    return null;
  }
}

export function contractorPortalUrl(token: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, '');
  return `${appUrl}/contractor/${token}`;
}

export { newPortalToken as newContractorToken, PORTAL_TOKEN_PATTERN as CONTRACTOR_TOKEN_PATTERN };

/** Hours × hourly rate, in cents, without floating-point drift. */
export function hoursAmount(rate: number | string, minutes: number): number {
  const rateCents = Math.round(Number(rate) * 100);
  return Math.round((rateCents * minutes) / 60) / 100;
}

/**
 * The pay date after `d` (YYYY-MM-DD), mirroring contractor_next_pay_date() in
 * SQL. Semimonthly pays on the 15th and on the last day of the month.
 */
export function nextPayDate(d: string, frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'): string {
  const [y, m, day] = d.split('-').map(Number);
  const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  const lastDay = (yy: number, mm: number) => utc(yy, mm + 1, 0).getUTCDate();
  let out: Date;
  if (frequency === 'weekly') out = utc(y, m - 1, day + 7);
  else if (frequency === 'biweekly') out = utc(y, m - 1, day + 14);
  else if (frequency === 'monthly') out = utc(y, m, Math.min(day, lastDay(y, m)));
  else if (day < 15) out = utc(y, m - 1, 15);
  else if (day < lastDay(y, m - 1)) out = utc(y, m - 1, lastDay(y, m - 1));
  else out = utc(y, m, 15);
  return out.toISOString().slice(0, 10);
}

type RowTable = 'contractors' | 'contractor_contracts' | 'contractor_work_items' | 'pay_runs';

/** Load a row's business, then authorize the caller on it (404 when it is not theirs). */
export async function authorizeContractorRow(
  request: NextRequest,
  table: RowTable,
  id: string,
  capability: Capability
) {
  if (!z.string().uuid().safeParse(id).success) return { ok: false as const, response: fail('Not found', 404) };
  const { data } = await serviceClient().from(table).select('business_id').eq('id', id).maybeSingle();
  if (!data) return { ok: false as const, response: fail('Not found', 404) };
  const result = await authorizeCatalog(request, data.business_id, capability);
  if (!result.ok && result.response.status === 403 && capability === 'business.read') {
    return { ok: false as const, response: fail('Not found', 404) };
  }
  return result;
}

/**
 * Sending money: a signed-in owner (funds.move), never an API key. A leaked
 * key can draft a pay run but cannot empty the business wallet into it.
 */
export async function authorizeFundsMove(request: NextRequest, businessId: string) {
  const supabase = serviceClient();
  const auth = await resolveMerchant(supabase, request);
  if ('error' in auth) return { ok: false as const, response: fail(auth.error, auth.status) };
  if (auth.apiKeyBusinessId) {
    return { ok: false as const, response: fail('Paying a pay run needs a signed-in owner, not an API key', 403) };
  }
  const authz = await authorizeBusiness(supabase, { merchantId: auth.merchantId, via: auth.via }, businessId, 'funds.move');
  if (!authz.ok) return { ok: false as const, response: fail(authz.error, authz.status) };
  return { ok: true as const, supabase, merchantId: auth.merchantId };
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
