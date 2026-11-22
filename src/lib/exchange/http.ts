/**
 * Shared HTTP plumbing for /api/exchange/* routes.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { isExchangeEnabled } from './policy';
import { ExchangeError } from './types';

export function exchangeSupabase(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Requester country, only from a header our edge sets. Unknown is null, which
 * crypto routes accept and fiat routes (when they exist) refuse.
 */
export function requestCountry(request: NextRequest): string | null {
  if (process.env.TRUST_VENDOR_IP_HEADERS !== 'true') return null;
  const c = request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}

export function disabledResponse(): NextResponse {
  return NextResponse.json(
    { error: 'The exchange is not available yet.', code: 'engine_disabled' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function guardEnabled(): NextResponse | null {
  return isExchangeEnabled() ? null : disabledResponse();
}

export function errorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof ExchangeError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  console.error(`[exchange] ${where}`, e);
  return NextResponse.json({ error: 'Exchange request failed', code: 'internal' }, { status: 500 });
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
