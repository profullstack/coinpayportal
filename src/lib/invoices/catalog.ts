import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveMerchant } from '@/lib/auth/merchant';
import { authorizeBusiness } from '@/lib/auth/authz';
import type { Capability } from '@/lib/auth/permissions';

/**
 * Saved tax rates and products/services, the two catalogs an itemised invoice
 * draws from. Both are per business; reads need business.read, writes
 * invoice.write, and an API key is locked to its own business.
 */

export const CATALOG_TABLES = {
  tax_rates: {
    columns: 'id, business_id, name, rate, is_default, created_at, updated_at',
    order: 'name',
    create: z
      .object({
        name: z.string().trim().min(1).max(64),
        rate: z
          .number()
          .finite()
          .min(0)
          .max(100)
          .refine((n) => n === Math.round(n * 1000) / 1000, 'Use at most three decimals'),
        is_default: z.boolean().optional(),
      })
      .strict(),
  },
  invoice_items: {
    columns:
      'id, business_id, name, description, unit_price, unit, tax_rate_id, archived, created_at, updated_at, tax_rates (id, name, rate)',
    order: 'name',
    create: z
      .object({
        name: z.string().trim().min(1).max(200),
        description: z.string().max(500).nullable().optional(),
        unit_price: z
          .number()
          .finite()
          .min(0)
          .max(999_999_999.99)
          .refine((n) => n === Math.round(n * 100) / 100, 'Use at most two decimals'),
        unit: z.string().trim().max(32).nullable().optional(),
        tax_rate_id: z.string().uuid().nullable().optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
  },
} as const;

export type CatalogTable = keyof typeof CATALOG_TABLES;

type Ok = { ok: true; supabase: SupabaseClient; businessId: string; merchantId: string };
type Err = { ok: false; response: NextResponse };

const fail = (error: string, status: number): Err => ({
  ok: false,
  response: NextResponse.json({ success: false, error }, { status }),
});

export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Resolve the caller and authorize `capability` on the requested business. */
export async function authorizeCatalog(
  request: NextRequest,
  requestedBusinessId: string | null | undefined,
  capability: Capability
): Promise<Ok | Err> {
  const supabase = serviceClient();
  const auth = await resolveMerchant(supabase, request);
  if ('error' in auth) return fail(auth.error, auth.status);
  if (auth.apiKeyBusinessId) {
    if (requestedBusinessId && requestedBusinessId !== auth.apiKeyBusinessId) {
      return fail('business_id does not match the API key', 403);
    }
    return { ok: true, supabase, businessId: auth.apiKeyBusinessId, merchantId: auth.merchantId };
  }
  if (!requestedBusinessId) return fail('business_id is required', 400);
  const authz = await authorizeBusiness(supabase, auth.merchantId, requestedBusinessId, capability);
  if (!authz.ok) return fail(authz.error, authz.status);
  return { ok: true, supabase, businessId: requestedBusinessId, merchantId: auth.merchantId };
}

/** Load a catalog row's business, then authorize the caller on it. */
export async function authorizeCatalogRow(
  request: NextRequest,
  table: CatalogTable | 'projects' | 'time_entries',
  id: string,
  capability: Capability
): Promise<Ok | Err> {
  if (!z.string().uuid().safeParse(id).success) return fail('Not found', 404);
  const { data } = await serviceClient().from(table).select('business_id').eq('id', id).maybeSingle();
  if (!data) return fail('Not found', 404);
  const result = await authorizeCatalog(request, data.business_id, capability);
  // Do not reveal that the row exists in a business the caller cannot see.
  if (!result.ok && result.response.status === 403 && capability === 'business.read') return fail('Not found', 404);
  return result;
}

export function parseCatalogBody(table: CatalogTable, body: unknown, partial: boolean) {
  const schema = partial ? CATALOG_TABLES[table].create.partial() : CATALOG_TABLES[table].create;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false as const, error: `${issue.path.join('.') || 'body'}: ${issue.message}` };
  }
  return { ok: true as const, data: parsed.data as Record<string, unknown> };
}

/** A tax_rate_id named on an item must belong to the same business. */
export async function checkTaxRateOwner(
  supabase: SupabaseClient,
  businessId: string,
  taxRateId: unknown
): Promise<boolean> {
  if (!taxRateId) return true;
  const { data } = await supabase.from('tax_rates').select('business_id').eq('id', taxRateId).maybeSingle();
  return data?.business_id === businessId;
}

/** Only one default tax rate per business. */
export async function clearOtherDefaults(supabase: SupabaseClient, businessId: string, keepId: string) {
  await supabase
    .from('tax_rates')
    .update({ is_default: false })
    .eq('business_id', businessId)
    .eq('is_default', true)
    .neq('id', keepId);
}
