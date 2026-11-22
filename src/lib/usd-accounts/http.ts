/**
 * What the /api/usd-accounts routes share: a store over the service-role
 * client and one shape of error response.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { SupabaseUsdAccountStore } from './store';
import { UsdAccountsError, type UsdAccountsDeps } from './service';

export function usdAccountsDeps(): UsdAccountsDeps {
  return { store: new SupabaseUsdAccountStore(getSupabaseAdmin()) };
}

export function usdAccountsErrorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof UsdAccountsError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`[${context}] failed`, err);
  return NextResponse.json({ error: 'The account partner request failed' }, { status: 502 });
}

export const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };
