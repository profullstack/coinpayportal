/**
 * What the /api/banking routes share: a store over the service-role client,
 * business scoping, and one shape of error response.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getBusiness } from '@/lib/business/service';
import { SupabaseBankStore } from './store';
import { BankTransferError, type BankingDeps } from './service';

export function bankingDeps(): BankingDeps {
  return { store: new SupabaseBankStore(getSupabaseAdmin()) };
}

/**
 * Resolve an optional business id to one the merchant owns, or answer with
 * the response that should go back. A business id that belongs to somebody
 * else is answered as not found, the same as one that does not exist.
 */
export async function resolveBusinessId(
  merchantId: string,
  raw: unknown,
): Promise<string | null | NextResponse> {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    return NextResponse.json({ error: 'businessId must be a string' }, { status: 400 });
  }
  const result = await getBusiness(getSupabaseAdmin(), raw, merchantId);
  if (!result.success || !result.business) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }
  return raw;
}

export function bankingErrorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof BankTransferError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`[${context}] failed`, err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Bank transfer request failed' },
    { status: 502 },
  );
}

export const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };
