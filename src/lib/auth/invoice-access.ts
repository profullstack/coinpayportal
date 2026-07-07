import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { resolveMerchant } from './merchant';
import { authorizeBusiness } from './authz';
import type { Capability } from './permissions';

/**
 * Resolve the caller and authorize them for a single invoice by the invoice's
 * OWNING BUSINESS — not by `invoices.user_id`.
 *
 * Invoices are created with `user_id = business.merchant_id` (the business
 * owner), so the legacy `.eq('user_id', callerId)` gate 404s every invoice a
 * team member owns/created/manages, even though they hold a role on the
 * business. This mirrors the business-scoped authz used by `GET/POST
 * /api/invoices` (see listAccessibleBusinessIds / authorizeBusiness) so the
 * whole `/api/invoices/[id]/*` family agrees on who may act.
 *
 * On success returns the fetched invoice plus the resolved caller. On failure
 * returns a ready-to-send status/error (404 is used both when the invoice does
 * not exist and when the caller cannot see its business, so existence is not
 * leaked).
 */
export type InvoiceAccessOk = {
  ok: true;
  merchantId: string;
  apiKeyBusinessId: string | null;
  invoice: any;
};
export type InvoiceAccessErr = { ok: false; status: number; error: string };

export async function authorizeInvoice(
  supabase: SupabaseClient,
  request: NextRequest,
  invoiceId: string,
  capability: Capability,
  select = '*',
): Promise<InvoiceAccessOk | InvoiceAccessErr> {
  const auth = await resolveMerchant(supabase, request);
  if ('error' in auth) return { ok: false, status: auth.status, error: auth.error };
  const { merchantId, apiKeyBusinessId } = auth;

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(select)
    .eq('id', invoiceId)
    .single();

  if (error || !invoice || !(invoice as any).business_id) {
    return { ok: false, status: 404, error: 'Invoice not found' };
  }
  const businessId = (invoice as any).business_id as string;

  if (apiKeyBusinessId) {
    // API keys are locked to their own business.
    if (businessId !== apiKeyBusinessId) {
      return { ok: false, status: 404, error: 'Invoice not found' };
    }
  } else {
    const authz = await authorizeBusiness(supabase, merchantId, businessId, capability);
    if (!authz.ok) {
      // 404 when the caller has no access at all (don't reveal the invoice exists);
      // 403 when they can see the business but lack the capability.
      return { ok: false, status: authz.status, error: authz.status === 404 ? 'Invoice not found' : authz.error };
    }
  }

  return { ok: true, merchantId, apiKeyBusinessId, invoice };
}
