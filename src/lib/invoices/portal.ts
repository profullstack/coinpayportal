import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadInvoiceSettings } from './settings';

/**
 * Client portal: one unguessable link per client that lists every invoice the
 * business has issued them, with a pay link on each open one. The token is the
 * whole credential (like a proposal's access_token), so it is 32 random bytes,
 * shown only to the merchant, and replaced or revoked on request.
 */

export const PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_STATUSES = ['sent', 'overdue', 'paid'];

export function newPortalToken(): string {
  return randomBytes(32).toString('base64url');
}

export function portalUrl(token: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com').replace(/\/$/, '');
  return `${appUrl}/portal/${token}`;
}

export type PortalInvoice = {
  id: string;
  invoice_number: string;
  status: string;
  currency: string;
  amount: string;
  due_date: string | null;
  created_at: string;
  paid_at: string | null;
};

export async function loadPortal(supabase: SupabaseClient, token: string) {
  if (!PORTAL_TOKEN_PATTERN.test(token)) return null;
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, company_name, business_id, businesses (id, name)')
    .eq('portal_token', token)
    .maybeSingle();
  if (!client) return null;

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, currency, amount, due_date, created_at, paid_at')
    .eq('business_id', client.business_id)
    .eq('client_id', client.id)
    .in('status', PUBLIC_STATUSES)
    .order('created_at', { ascending: false })
    .limit(500);

  const rows = (invoices ?? []) as PortalInvoice[];
  // Outstanding per currency, in cents, so mixed currencies never add up.
  const outstanding: Record<string, number> = {};
  for (const inv of rows) {
    if (inv.status === 'paid') continue;
    outstanding[inv.currency] = (outstanding[inv.currency] ?? 0) + Math.round(Number(inv.amount) * 100);
  }

  const settings = await loadInvoiceSettings(supabase, client.business_id);
  const business = client.businesses as unknown as { name: string } | null;
  return {
    client: { name: client.company_name || client.name || null },
    business: { name: business?.name ?? null },
    brand: { color: settings.brand_color, logo_url: settings.logo_url, footer: settings.invoice_footer },
    invoices: rows,
    outstanding: Object.entries(outstanding).map(([currency, cents]) => ({ currency, amount: cents / 100 })),
  };
}
